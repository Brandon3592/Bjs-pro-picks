import { useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { HelpCircle, Send, CheckCircle, MessageSquare, Clock, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "idle" | "submitting" | "success" | "error";

export default function HelpPage() {
  const { user } = useAuth();

  const [name, setName] = useState((user as any)?.name ?? "");
  const [email, setEmail] = useState((user as any)?.email ?? "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) return;
    setStatus("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/support/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), email: email.trim(), subject: subject.trim(), message: message.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any).error || "Failed to submit");
      }
      setStatus("success");
      setSubject("");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <HelpCircle className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Help & Support</h1>
          <p className="text-sm text-muted-foreground">Have a question or concern? We're here to help.</p>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: MessageSquare, title: "Submit a request", body: "Fill out the form below and we'll get back to you." },
          { icon: Clock, title: "Response time", body: "We typically respond within 24–48 hours." },
          { icon: Mail, title: "Email reply", body: "Replies are sent directly to the email you provide." },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-border bg-card p-4 space-y-1.5">
            <Icon className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
          </div>
        ))}
      </div>

      {/* Success state */}
      {status === "success" && (
        <div className="flex items-start gap-3 px-4 py-4 rounded-xl border border-primary/30 bg-primary/10">
          <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-primary">Message sent!</p>
            <p className="text-sm text-muted-foreground mt-0.5">We received your request and will reply to <span className="text-foreground font-medium">{email}</span> soon.</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {status === "error" && (
        <div className="px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/10">
          <p className="text-sm text-destructive">{errorMsg}</p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">Send us a message</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Full name"
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@email.com"
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            placeholder="Brief description of your question or issue"
            className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            rows={6}
            placeholder="Please describe your question, comment, or concern in detail..."
            className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={status === "submitting" || !name.trim() || !email.trim() || !subject.trim() || !message.trim()}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all",
            status === "submitting"
              ? "bg-primary/50 text-primary-foreground/70 cursor-not-allowed"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          <Send className="h-4 w-4" />
          {status === "submitting" ? "Sending…" : "Send Message"}
        </button>
      </form>
    </div>
  );
}
