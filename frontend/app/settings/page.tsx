"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Trash2, Check } from "lucide-react";
import { SiteNav } from "@/components/site-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { resetDocuments } from "@/lib/api";

const STORAGE_KEY = "missiondoc_api_key";

// These mirror the constants in backend/rag_chain.py and ingestion.py.
// They aren't yet exposed as a runtime-configurable API, so they're shown
// here as reference values rather than editable controls that would
// silently do nothing.
const RETRIEVAL_CONFIG = [
  { label: "Chunk size", value: "1000 characters" },
  { label: "Chunk overlap", value: "150 characters" },
  { label: "Top-K retrieved chunks", value: "5" },
  { label: "Minimum similarity threshold", value: "0.35" },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setApiKey(stored);
  }, []);

  const saveKey = () => {
    localStorage.setItem(STORAGE_KEY, apiKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const clearKey = () => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey("");
  };

  const resetMutation = useMutation({
    mutationFn: resetDocuments,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });

  return (
    <main className="min-h-screen">
      <SiteNav />

      <div className="mx-auto max-w-2xl px-6 pb-24 md:px-12">
        <h1 className="font-display text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 mb-8 text-sm text-muted">
          Configure your Gemini API key and manage the knowledge base.
        </p>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Gemini API Key</CardTitle>
            <CardDescription>
              Stored only in this browser (localStorage) — never sent anywhere except directly
              to your own backend when you chat or upload documents. Leave blank to use the
              backend&apos;s <code className="font-mono text-[11px]">GEMINI_API_KEY</code> environment
              variable instead, if one is set.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIza..."
                className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
              />
              <button
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" onClick={saveKey}>
                {saved ? <Check className="h-3.5 w-3.5" /> : null}
                {saved ? "Saved" : "Save key"}
              </Button>
              <Button variant="ghost" size="sm" onClick={clearKey} disabled={!apiKey}>
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Retrieval configuration</CardTitle>
            <CardDescription>
              Current pipeline defaults, set in the backend. Runtime tuning from this page isn&apos;t
              wired up yet — treat these as reference values for now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {RETRIEVAL_CONFIG.map((row) => (
                <div key={row.label} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-muted">{row.label}</span>
                  <span className="font-mono text-xs">{row.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Knowledge base</CardTitle>
            <CardDescription>
              Permanently deletes every ingested document and chunk. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirm("Reset the entire knowledge base? This deletes all documents and cannot be undone.")) {
                  resetMutation.mutate();
                }
              }}
              disabled={resetMutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {resetMutation.isPending ? "Resetting..." : "Reset knowledge base"}
            </Button>
            {resetMutation.isSuccess && (
              <p className="mt-2 text-xs text-success">Knowledge base cleared.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
