import React, { useState } from "react";
import {
  Globe,
  Search,
  Sparkles,
  Layers,
  Code2,
  ExternalLink,
  Copy,
  Check,
  X,
  FileText,
  ShieldCheck,
  Clock,
  ChevronRight,
  Database,
  RefreshCw,
  Send,
  Link as LinkIcon
} from "lucide-react";

interface CrawledResult {
  url: string;
  finalUrl: string;
  domain: string;
  metadata: {
    title: string;
    description?: string;
    author?: string;
    statusCode: number;
  };
  markdown: string;
  estimatedTokens: number;
  links: Array<{ text: string; url: string; isInternal: boolean }>;
  headings: Array<{ level: number; text: string }>;
  robotsAllowed: boolean;
  crawlDurationMs: number;
}

interface DeepCrawlData {
  domain: string;
  pagesCrawled: number;
  totalTokens: number;
  pages: CrawledResult[];
  combinedMarkdown: string;
}

export default function WebCrawlerStudioModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"single" | "deep" | "query" | "json">("single");
  const [maxPages, setMaxPages] = useState(5);
  const [queryPrompt, setQueryPrompt] = useState("");
  const [jsonSchema, setJsonSchema] = useState("Extract title, main features, pricing tiers if any, and contact email.");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  
  const [crawledData, setCrawledData] = useState<CrawledResult | null>(null);
  const [deepData, setDeepData] = useState<DeepCrawlData | null>(null);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [structuredJson, setStructuredJson] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<"markdown" | "ai" | "links" | "json">("markdown");
  const [copied, setCopied] = useState(false);

  const handleCrawl = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setStatusMsg("Connecting & checking robots.txt...");
    setCrawledData(null);
    setDeepData(null);
    setAiAnswer(null);
    setStructuredJson(null);

    try {
      if (mode === "single") {
        setStatusMsg(`Crawling ${url} and cleaning HTML into Markdown...`);
        const res = await fetch("/api/crawler/crawl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), respectRobots: true }),
        });
        const json = await res.json();
        if (json.ok && json.result) {
          setCrawledData(json.result);
          setActiveTab("markdown");
        } else {
          alert(`Crawl failed: ${json.error || "Unknown error"}`);
        }
      } else if (mode === "deep") {
        setStatusMsg(`Running deep multi-page crawl (max ${maxPages} pages)...`);
        const res = await fetch("/api/crawler/deep-crawl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), maxPages }),
        });
        const json = await res.json();
        if (json.ok && json.result) {
          setDeepData(json.result);
          setActiveTab("markdown");
        } else {
          alert(`Deep crawl failed: ${json.error || "Unknown error"}`);
        }
      } else if (mode === "query") {
        setStatusMsg(`Crawling and asking AI: "${queryPrompt || "Summarize website"}"...`);
        const res = await fetch("/api/crawler/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            urlOrMarkdown: url.trim(),
            query: queryPrompt || "Summarize this website in detail: main topics, key specs, pricing, and insights.",
          }),
        });
        const json = await res.json();
        if (json.ok && json.response) {
          setAiAnswer(json.response.answer);
          setActiveTab("ai");
        } else {
          alert(`AI Query failed: ${json.error || "Unknown error"}`);
        }
      } else if (mode === "json") {
        setStatusMsg("Crawling and extracting structured JSON data with Gemini...");
        const res = await fetch("/api/crawler/extract-json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            urlOrMarkdown: url.trim(),
            schema: jsonSchema,
          }),
        });
        const json = await res.json();
        if (json.ok && json.data) {
          setStructuredJson(json.data);
          setActiveTab("json");
        } else {
          alert(`JSON extraction failed: ${json.error || "Unknown error"}`);
        }
      }
    } catch (err: any) {
      alert(`Network Error: ${err?.message || err}`);
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  };

  const handleAskAIAboutCurrentCrawl = async () => {
    if (!queryPrompt.trim()) return;
    const content = deepData?.combinedMarkdown || crawledData?.markdown;
    if (!content) return;

    setLoading(true);
    setStatusMsg(`Synthesizing answer for: "${queryPrompt}"...`);
    try {
      const res = await fetch("/api/crawler/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urlOrMarkdown: content,
          query: queryPrompt,
        }),
      });
      const json = await res.json();
      if (json.ok && json.response) {
        setAiAnswer(json.response.answer);
        setActiveTab("ai");
      }
    } catch (e: any) {
      alert(`Error: ${e?.message || e}`);
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 animate-fade-in">
      <div className="relative w-full max-w-6xl h-[90vh] bg-zinc-950 border border-zinc-800/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Globe className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-wide flex items-center gap-2 text-zinc-100">
                Friday AI Web Intelligence Studio
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                  Crawl4AI & RAG Engine
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Crawl any website, extract pristine LLM Markdown, synthesize multi-page insights, or extract structured JSON.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Control Bar & URL Input */}
        <div className="p-5 border-b border-zinc-800/60 bg-zinc-900/30 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setMode("single")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                mode === "single"
                  ? "bg-cyan-600 text-white shadow-lg shadow-cyan-600/20"
                  : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <FileText className="w-3.5 h-3.5" /> Single Page Crawl
            </button>
            <button
              onClick={() => setMode("deep")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                mode === "deep"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-600/20"
                  : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5" /> Deep Multi-Page Crawl
            </button>
            <button
              onClick={() => setMode("query")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                mode === "query"
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20"
                  : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" /> AI Q&A & Research
            </button>
            <button
              onClick={() => setMode("json")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                mode === "json"
                  ? "bg-amber-600 text-white shadow-lg shadow-amber-600/20"
                  : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Database className="w-3.5 h-3.5" /> Structured JSON Extract
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Globe className="absolute left-3.5 top-3 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                placeholder="Enter target website URL (e.g. https://github.com/features or docs.example.com)..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCrawl()}
                className="w-full pl-10 pr-4 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            {mode === "deep" && (
              <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 px-3 py-1.5 rounded-xl text-xs">
                <span className="text-zinc-400">Max Pages:</span>
                <select
                  value={maxPages}
                  onChange={(e) => setMaxPages(Number(e.target.value))}
                  className="bg-zinc-800 text-zinc-200 rounded px-1 py-0.5 border border-zinc-700 focus:outline-none"
                >
                  <option value={3}>3 pages</option>
                  <option value={5}>5 pages</option>
                  <option value={10}>10 pages</option>
                  <option value={15}>15 pages</option>
                </select>
              </div>
            )}

            <button
              onClick={handleCrawl}
              disabled={loading || !url.trim()}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-cyan-600/20 transition"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Crawling...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Crawl & Extract
                </>
              )}
            </button>
          </div>

          {/* Conditional Query / Schema inputs */}
          {mode === "query" && (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ask specific questions about this website (e.g. 'What are the pricing options and API limits?')..."
                value={queryPrompt}
                onChange={(e) => setQueryPrompt(e.target.value)}
                className="flex-1 px-4 py-2 bg-zinc-900/80 border border-zinc-700/60 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}

          {mode === "json" && (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Describe JSON Schema or fields to extract (e.g. 'product name, price, stock status, ratings')..."
                value={jsonSchema}
                onChange={(e) => setJsonSchema(e.target.value)}
                className="flex-1 px-4 py-2 bg-zinc-900/80 border border-zinc-700/60 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
              />
            </div>
          )}

          {statusMsg && (
            <div className="text-xs text-cyan-400 font-medium animate-pulse flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {statusMsg}
            </div>
          )}
        </div>

        {/* Content Tabs & Main Viewer */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-2.5 border-b border-zinc-800 bg-zinc-900/40 text-xs">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab("markdown")}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  activeTab === "markdown" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Clean Markdown Preview
              </button>
              <button
                onClick={() => setActiveTab("ai")}
                className={`px-3 py-1 rounded-lg font-medium flex items-center gap-1 transition ${
                  activeTab === "ai" ? "bg-zinc-800 text-emerald-400" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Sparkles className="w-3 h-3" /> AI Insights & Q&A
              </button>
              <button
                onClick={() => setActiveTab("links")}
                className={`px-3 py-1 rounded-lg font-medium flex items-center gap-1 transition ${
                  activeTab === "links" ? "bg-zinc-800 text-cyan-400" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <LinkIcon className="w-3 h-3" /> Extracted Links ({crawledData?.links.length || 0})
              </button>
              {structuredJson && (
                <button
                  onClick={() => setActiveTab("json")}
                  className={`px-3 py-1 rounded-lg font-medium flex items-center gap-1 transition ${
                    activeTab === "json" ? "bg-zinc-800 text-amber-400" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Code2 className="w-3 h-3" /> Structured JSON
                </button>
              )}
            </div>

            {/* Stats badges */}
            {(crawledData || deepData) && (
              <div className="flex items-center gap-3 text-zinc-400">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Robots.txt: Allowed
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  {crawledData ? `${crawledData.crawlDurationMs}ms` : `${deepData?.pagesCrawled} pages`}
                </span>
                <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                  ~{crawledData?.estimatedTokens || deepData?.totalTokens || 0} tokens
                </span>
                <button
                  onClick={() =>
                    copyToClipboard(
                      activeTab === "ai"
                        ? aiAnswer || ""
                        : activeTab === "json"
                        ? JSON.stringify(structuredJson, null, 2)
                        : deepData?.combinedMarkdown || crawledData?.markdown || ""
                    )
                  }
                  className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
                  title="Copy content"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>

          {/* Tab Panes */}
          <div className="flex-1 overflow-y-auto p-6 font-mono text-sm leading-relaxed bg-zinc-950/80">
            {activeTab === "markdown" && (
              <div>
                {deepData ? (
                  <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-300 selection:bg-cyan-500/30">
                    {deepData.combinedMarkdown}
                  </pre>
                ) : crawledData ? (
                  <div>
                    <div className="mb-4 p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 text-xs font-sans">
                      <h3 className="text-base font-bold text-zinc-100 mb-1">{crawledData.metadata.title}</h3>
                      {crawledData.metadata.description && (
                        <p className="text-zinc-400 mb-2">{crawledData.metadata.description}</p>
                      )}
                      <div className="flex flex-wrap gap-2 text-zinc-500 text-[11px]">
                        <span>Domain: {crawledData.domain}</span>
                        <span>•</span>
                        <span>Status: {crawledData.metadata.statusCode}</span>
                        <span>•</span>
                        <span>Raw HTML: {crawledData.rawHtmlLength} bytes</span>
                        <span>•</span>
                        <span>Clean Markdown: {crawledData.markdownLength} bytes</span>
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-300 selection:bg-cyan-500/30">
                      {crawledData.markdown}
                    </pre>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-3 py-16 font-sans">
                    <Globe className="w-12 h-12 text-zinc-700" />
                    <p className="text-sm">Enter any website URL above and click "Crawl & Extract" to see clean Markdown.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "ai" && (
              <div className="font-sans flex flex-col h-full">
                {aiAnswer ? (
                  <div className="space-y-4">
                    <div className="p-5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-emerald-200">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4" /> AI Synthesized Intelligence
                      </h4>
                      <div className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">
                        {aiAnswer}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-3 py-16">
                    <Sparkles className="w-12 h-12 text-zinc-700" />
                    <p className="text-sm">Ask a question about the crawled webpage to generate instant AI insights.</p>
                  </div>
                )}

                {/* Live follow-up question box */}
                {(crawledData || deepData) && (
                  <div className="mt-auto pt-4 border-t border-zinc-800/80 flex gap-2">
                    <input
                      type="text"
                      placeholder="Ask a follow-up question about this website..."
                      value={queryPrompt}
                      onChange={(e) => setQueryPrompt(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAskAIAboutCurrentCrawl()}
                      className="flex-1 px-4 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      onClick={handleAskAIAboutCurrentCrawl}
                      disabled={loading || !queryPrompt.trim()}
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 transition"
                    >
                      <Send className="w-3.5 h-3.5" /> Ask AI
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === "links" && (
              <div className="font-sans space-y-2">
                {crawledData?.links && crawledData.links.length > 0 ? (
                  crawledData.links.map((link, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 text-xs transition"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            link.isInternal
                              ? "bg-cyan-950 text-cyan-400 border border-cyan-800/60"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {link.isInternal ? "Internal" : "External"}
                        </span>
                        <span className="font-medium text-zinc-200">{link.text}</span>
                        <span className="text-zinc-500 truncate">{link.url}</span>
                      </div>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-zinc-500">No links extracted yet.</p>
                )}
              </div>
            )}

            {activeTab === "json" && (
              <div>
                <pre className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 text-xs text-amber-300 font-mono overflow-x-auto">
                  {JSON.stringify(structuredJson, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-900/70 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-zinc-300">
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              Direct LLM Prompting & Vector RAG Ready
            </span>
            <span className="text-zinc-500">•</span>
            <span>Firecrawl/Crawl4AI Protocol Compliant</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition"
          >
            Close Studio
          </button>
        </div>

      </div>
    </div>
  );
}
