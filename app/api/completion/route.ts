import groq, { GROQ_MODEL, GROQ_REASONING_OPTIONS, CHAT_CONFIG_ERROR, modelTokenOptions, streamGroq } from "@/lib/groq";
import { groqErrorResponse } from "@/lib/groq-errors";
import { FLAGS } from "@/lib/types";
import { buildPrompt, buildSummerizerPrompt, buildRAGPrompt, buildKnowledgeCheckPrompt } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (CHAT_CONFIG_ERROR) return groqErrorResponse({ code: 'configuration_error' });
  const { bg, flag, prompt: transcribe, responseLanguage = 'en' } = await req.json();

  if (flag === FLAGS.COPILOT) {
    // Step 1: Check if AI has knowledge about the question
    console.log('🤔 Checking AI knowledge...');
    
    let knowledgeCheck;
    try {
      knowledgeCheck = process.env.PINECONE_API_KEY && process.env.GEMINI_API_KEY
        ? { choices: [{ message: { content: 'NEED_CONTEXT: Search configured interview notes' } }] }
        : await groq.chat.completions.create({
        ...GROQ_REASONING_OPTIONS,
        messages: [
          {
            role: 'user',
            content: buildKnowledgeCheckPrompt(transcribe)
          }
        ],
        model: GROQ_MODEL,
        temperature: 0.3, // Lower temperature for decision making
        ...modelTokenOptions(1024),
        stream: false, // Non-streaming for quick decision
      });
    } catch (error) {
      console.error('Knowledge check error:', error);
      // Fallback to RAG if knowledge check fails
      knowledgeCheck = { choices: [{ message: { content: 'NEED_CONTEXT: Unable to determine' } }] };
    }

    const knowledgeResponse = knowledgeCheck.choices[0]?.message?.content || '';
    // Configured personal documents must be searched even for familiar questions.
    const hasKnowledge = knowledgeResponse.startsWith('KNOWN:') &&
      !(process.env.PINECONE_API_KEY && process.env.GEMINI_API_KEY);
    
    console.log('🧠 Knowledge check result:', hasKnowledge ? 'HAS_KNOWLEDGE' : 'NEEDS_CONTEXT');
    console.log('📝 Response preview:', knowledgeResponse.substring(0, 100) + '...');

    if (hasKnowledge) {
      // AI has knowledge - respond immediately
      console.log('⚡ Responding with AI knowledge...');
      
      const immediatePrompt = buildPrompt(bg, transcribe, responseLanguage);
      
      let groqStream;
      try {
        groqStream = await streamGroq(immediatePrompt);
      } catch (error) {
        console.error('Groq API error:', error);
        
        return groqErrorResponse(error);
      }

      const encoder = new TextEncoder();
      const responseStream = new ReadableStream({
        async start(controller) {
          try {
            let hasContent = false;
            
            for await (const chunk of groqStream) {
              const content = chunk;
              if (content) {
                hasContent = true;
                controller.enqueue(encoder.encode(content));
              }
            }

            if (!hasContent) {
              controller.enqueue(encoder.encode('Sorry, I could not generate a response at this time.'));
            }

            controller.close();
          } catch (error) {
            console.error('Streaming error:', error);
            try {
              controller.enqueue(encoder.encode(`Error: ${error instanceof Error ? error.message : 'Unknown streaming error'}`));
              controller.close();
            } catch (controllerError) {
              console.error('Controller error:', controllerError);
              controller.error(error);
            }
          }
        },
      });

      return new Response(responseStream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
        },
      });

    } else {
      // AI needs context - use RAG agents
      console.log('🔍 AI needs context, using RAG agents...');
      
      let ragContext: any = null;
      let extractedQuestion: any = null;
      
      try {
        const { ragOrchestrator } = await import('@/lib/agents/ragOrchestrator');
        const ragData = await ragOrchestrator.processTranscript(transcribe, bg, responseLanguage);
        
        extractedQuestion = ragData.extractedQuestion;
        ragContext = ragData.context;
        
        console.log('📊 RAG Processing Results:');
        console.log(`   Search performed: ${ragData.searchPerformed}`);
        console.log(`   PDF results: ${ragContext.pdfResults.length}`);
        console.log(`   Web results: ${ragContext.webResults.length}`);
        console.log(`   Combined context length: ${ragContext.combinedContext.length}`);
        console.log(`   Citations: ${ragContext.citations.length}`);
        
        if (ragData.searchPerformed && ragContext.combinedContext?.trim()) {
          console.log('📚 Using RAG context for response...');
          
          const ragPrompt = buildRAGPrompt(bg, transcribe, extractedQuestion?.question || transcribe, ragContext.combinedContext, responseLanguage);
          
          let groqStream;
          try {
            groqStream = await streamGroq(ragPrompt);
          } catch (error) {
            console.error('Groq API error:', error);
            
            return groqErrorResponse(error);
          }

          const encoder = new TextEncoder();
          const responseStream = new ReadableStream({
            async start(controller) {
              try {
                let hasContent = false;
                
                for await (const chunk of groqStream) {
                  const content = chunk;
                  if (content) {
                    hasContent = true;
                    controller.enqueue(encoder.encode(content));
                  }
                }

                if (!hasContent) {
                  controller.enqueue(encoder.encode('Sorry, I could not generate a response at this time.'));
                }

                // Send sources if available
                if (ragContext && ragContext.citations.length > 0) {
                  console.log('📚 Sending sources...');
                  
                  const citationsData = JSON.stringify({
                    type: 'citations',
                    citations: ragContext.citations,
                    extractedQuestion: extractedQuestion?.question || null
                  }) + '\n';
                  
                  controller.enqueue(encoder.encode('\n\n---SOURCES---\n' + citationsData));
                }

                controller.close();
              } catch (error) {
                console.error('Streaming error:', error);
                try {
                  controller.enqueue(encoder.encode(`Error: ${error instanceof Error ? error.message : 'Unknown streaming error'}`));
                  controller.close();
                } catch (controllerError) {
                  console.error('Controller error:', controllerError);
                  controller.error(error);
                }
              }
            },
          });

          return new Response(responseStream, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Transfer-Encoding": "chunked",
            },
          });
        } else {
          // RAG failed, fallback to AI knowledge
          console.log('⚠️ RAG failed, falling back to AI knowledge...');
          
          const fallbackPrompt = buildPrompt(bg, transcribe, responseLanguage);
          
          let groqStream;
          try {
            groqStream = await streamGroq(fallbackPrompt);
          } catch (error) {
            console.error('Groq API error:', error);
            
            return groqErrorResponse(error);
          }

          const encoder = new TextEncoder();
          const responseStream = new ReadableStream({
            async start(controller) {
              try {
                let hasContent = false;
                
                for await (const chunk of groqStream) {
                  const content = chunk;
                  if (content) {
                    hasContent = true;
                    controller.enqueue(encoder.encode(content));
                  }
                }

                if (!hasContent) {
                  controller.enqueue(encoder.encode('Sorry, I could not generate a response at this time.'));
                }

                controller.close();
              } catch (error) {
                console.error('Streaming error:', error);
                try {
                  controller.enqueue(encoder.encode(`Error: ${error instanceof Error ? error.message : 'Unknown streaming error'}`));
                  controller.close();
                } catch (controllerError) {
                  console.error('Controller error:', controllerError);
                  controller.error(error);
                }
              }
            },
          });

          return new Response(responseStream, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Transfer-Encoding": "chunked",
            },
          });
        }
      } catch (ragError) {
        console.error('RAG processing error:', ragError);
        
        // Fallback to AI knowledge if RAG completely fails
        console.log('⚠️ RAG failed, falling back to AI knowledge...');
        
        const fallbackPrompt = buildPrompt(bg, transcribe, responseLanguage);
        
        let groqStream;
        try {
          groqStream = await streamGroq(fallbackPrompt);
        } catch (error) {
          console.error('Groq API error:', error);
          
          return groqErrorResponse(error);
        }

        const encoder = new TextEncoder();
        const responseStream = new ReadableStream({
          async start(controller) {
            try {
              let hasContent = false;
              
              for await (const chunk of groqStream) {
                const content = chunk;
                if (content) {
                  hasContent = true;
                  controller.enqueue(encoder.encode(content));
                }
              }

              if (!hasContent) {
                controller.enqueue(encoder.encode('Sorry, I could not generate a response at this time.'));
              }

              controller.close();
            } catch (error) {
              console.error('Streaming error:', error);
              try {
                controller.enqueue(encoder.encode(`Error: ${error instanceof Error ? error.message : 'Unknown streaming error'}`));
                controller.close();
              } catch (controllerError) {
                console.error('Controller error:', controllerError);
                controller.error(error);
              }
            }
          },
        });

        return new Response(responseStream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Transfer-Encoding": "chunked",
          },
        });
      }
    }
  } else if (flag === FLAGS.SUMMERIZER) {
    // Handle summarizer flag
    const prompt = buildSummerizerPrompt(transcribe, responseLanguage);
    
    let groqStream;
    try {
      groqStream = await streamGroq(prompt);
    } catch (error) {
      console.error('Groq API error:', error);
      
      return groqErrorResponse(error);
    }

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          let hasContent = false;
          
          for await (const chunk of groqStream) {
            const content = chunk;
            if (content) {
              hasContent = true;
              controller.enqueue(encoder.encode(content));
            }
          }

          if (!hasContent) {
            controller.enqueue(encoder.encode('No response received from AI service. Please try again.'));
          }

          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          try {
            controller.enqueue(encoder.encode(`Error: ${error instanceof Error ? error.message : 'Unknown streaming error'}`));
            controller.close();
          } catch (controllerError) {
            console.error('Controller error:', controllerError);
            controller.error(error);
          }
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  }

  // Fallback response
  return new Response(JSON.stringify({ error: 'Invalid request flag' }), {
    status: 400,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
