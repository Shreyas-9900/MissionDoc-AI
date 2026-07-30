import { SiteNav } from "@/components/site-nav";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Search, MessageSquare, Database } from "lucide-react";

const STEPS = [
  {
    icon: FileText,
    title: "Ingestion",
    body: "PDFs are parsed page-by-page with PyMuPDF, then split into ~1000-character overlapping chunks with LangChain's RecursiveCharacterTextSplitter.",
  },
  {
    icon: Database,
    title: "Embedding & storage",
    body: "Each chunk is embedded with Gemini's gemini-embedding-001 model and stored in a persistent local ChromaDB collection, alongside its source filename and page number.",
  },
  {
    icon: Search,
    title: "Retrieval",
    body: "A question is embedded the same way, and the top-5 most similar chunks are retrieved by cosine similarity. Follow-up questions are first resolved against recent chat history.",
  },
  {
    icon: MessageSquare,
    title: "Grounded generation",
    body: "Retrieved chunks are inserted into a prompt sent to Gemini, which is instructed to answer only from that context and cite the source document — never from its own general knowledge.",
  },
];

export default function AboutPage() {
  return (
    <main className="min-h-screen">
      <SiteNav />

      <div className="mx-auto max-w-2xl px-6 pb-24 md:px-12">
        <h1 className="font-display text-3xl font-bold tracking-tight">About MissionDoc AI</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          MissionDoc AI is a Retrieval-Augmented Generation (RAG) system for space mission
          documents — ISRO/DRDO mission reports, launch vehicle manuals, and similar technical
          PDFs. It answers questions strictly from the documents you upload, citing the exact
          source page for every claim, rather than relying on a language model&apos;s general
          training knowledge.
        </p>

        <div className="mt-10 space-y-4">
          {STEPS.map((step, i) => (
            <Card key={step.title}>
              <CardContent className="flex gap-4 p-5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <step.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">
                    <span className="mr-2 font-mono text-xs text-muted">0{i + 1}</span>
                    {step.title}
                  </p>
                  <p className="text-xs leading-relaxed text-muted">{step.body}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-10">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted">Stack</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            {["Next.js", "FastAPI", "Gemini API", "LangChain", "ChromaDB", "PyMuPDF"].map((t) => (
              <span key={t} className="rounded-full border border-border px-3 py-1 font-mono text-muted">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
