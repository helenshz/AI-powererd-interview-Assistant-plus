import { NextRequest, NextResponse } from "next/server";
import { Pinecone } from '@pinecone-database/pinecone';
import { generateTextEmbedding } from '@/lib/gemini-embeddings';
import { documentVectorId } from '@/lib/document-vector-id';
import { safePdfParse } from '../../../lib/safePdfParse';

// Use Node.js runtime for PDF processing
export const runtime = 'nodejs';

async function uploadPDFToVectorDB(file: File): Promise<boolean> {
  try {
    if (!process.env.PINECONE_API_KEY || !process.env.GEMINI_API_KEY) {
      throw new Error('请配置 PINECONE_API_KEY 和 GEMINI_API_KEY，并重启服务。');
    }

    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    // Parse PDF
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const pdfData = await safePdfParse(buffer);

    // Split into chunks
    if (!pdfData.text?.trim()) throw new Error('PDF 中没有可提取的文字，扫描版 PDF 需要先进行 OCR。');
    const chunks = splitIntoChunks(pdfData.text, 1500);
    
    // Generate embeddings and store
    const indexName = process.env.PINECONE_INDEX_NAME || 'interview-docs';
    const index = pinecone.index(indexName);
    const vectors = [];

    console.log('🧮 Generating Gemini embeddings...');
    for (let i = 0; i < chunks.length; i++) {
      const values = await generateTextEmbedding(chunks[i]);

      vectors.push({
        id: documentVectorId(file.name, i),
        values,
        metadata: {
          content: chunks[i],
          filename: file.name,
          chunkIndex: i,
          title: file.name.replace('.pdf', ''),
          uploadDate: new Date().toISOString(),
          contentType: 'text'
        }
      });
    }

    for (let offset = 0; offset < vectors.length; offset += 100) {
      await index.upsert(vectors.slice(offset, offset + 100));
    }
    return true;
  } catch (error) {
    console.error('Error uploading PDF:', error);
    throw error;
  }
}

function splitIntoChunks(text: string, chunkSize: number): string[] {
  const characters = Array.from(text);
  const chunks: string[] = [];
  
  for (let i = 0; i < characters.length; i += chunkSize) {
    const chunk = characters.slice(i, i + chunkSize).join('').trim();
    if (chunk) chunks.push(chunk);
  }
  
  return chunks;
}

async function deletePDFFromVectorDB(filename: string): Promise<boolean> {
  try {
    if (!process.env.PINECONE_API_KEY) {
      return false;
    }

    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    const indexName = process.env.PINECONE_INDEX_NAME || 'interview-docs';
    const index = pinecone.index(indexName);
    
    // Find all chunks for this document
    const searchResponse = await index.query({
      vector: new Array(768).fill(0), // Gemini text-embedding-004 dimensions
      topK: 10000,
      includeMetadata: true,
      filter: { filename: { $eq: filename } }
    });

    if (searchResponse.matches && searchResponse.matches.length > 0) {
      const idsToDelete = searchResponse.matches.map(match => match.id);
      await index.deleteMany(idsToDelete);
    }

    return true;
  } catch (error) {
    console.error('Error deleting document:', error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
    }

    const success = await uploadPDFToVectorDB(file);

    if (success) {
      return NextResponse.json({ 
        message: "PDF uploaded successfully",
        filename: file.name,
        size: file.size
      });
    } else {
      return NextResponse.json({ error: "Failed to upload PDF" }, { status: 500 });
    }
  } catch (error) {
    console.error("PDF upload error:", error);
    const message = error instanceof Error ? error.message : '';
    const safeMessage = /^(Gemini |请配置|无法连接 Gemini|PDF 中)/.test(message)
      ? message
      : /index|dimension|not found/i.test(message)
        ? 'Pinecone 索引不存在或维度不匹配，请检查 interview-docs 索引是否已创建，维度应为 768。'
        : /pdf|password|encrypt|invalid|format/i.test(message)
          ? 'PDF 解析失败，请检查文件是否损坏或加密，或重新导出 PDF 后上传。'
          : 'PDF 入库失败，请查看服务端日志，检查 Pinecone Key、索引及网络连接。';
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get("filename");

    if (!filename) {
      return NextResponse.json({ error: "No filename provided" }, { status: 400 });
    }

    const success = await deletePDFFromVectorDB(filename);

    if (success) {
      return NextResponse.json({ message: "PDF deleted successfully" });
    } else {
      return NextResponse.json({ error: "Failed to delete PDF" }, { status: 500 });
    }
  } catch (error) {
    console.error("PDF delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
