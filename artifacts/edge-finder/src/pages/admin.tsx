import { useState, useEffect } from "react";
import { ShieldCheck, Users, MessageSquare, Mail, Clock, CheckCircle, Eye, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type AdminUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  createdAt: string;
};

type Submission = {
  id: number;
  userId: string | null;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  adminReply: string | null;
  repliedAt: string | null;
  createdAt: string;
};

type AuthUser = { isAdmin: boolean; id: string };

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    new: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    read: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    replied: "bg-primary/15 text-primary border-primary/30",
  };
  return (
    <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded border", variants[status] ?? variants.new)}>
      {status}
    </span>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<"users" | "submissions">("submissions");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [replyId, setReplyId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/user", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAuthUser(d as AuthUser))
      .finally(() => setAuthLoading(false));
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      if (tab === "users") {
        const r = await fetch("/api/admin/users", { credentials: "include" });
        setUsers(await r.json());
      } else {
        const r = await fetch("/api/admin/submissions", { credentials: "include" });
        setSubmissions(await r.json());
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authUser?.isAdmin) loadData();
  }, [tab, authUser]);

  async function markRead(id: number) {
    await fetch(`/api/admin/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status: "read" }),
    });
    setSubmissions((prev) => prev.map((s) => s.id === id ? { ...s, status: "read" } : s));
  }

  async function sendReply(id: number) {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    try {
      const sub = submissions.find((s) => s.id === id);
      if (!sub) return;
      await fetch(`/api/admin/submissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ adminReply: replyText }),
      });
      const mailto = `mailto:${sub.email}?subject=Re: ${encodeURIComponent(sub.subject)}&body=${encodeURIComponent(`Hi ${sub.name},\n\n${replyText}\n\n—BJ's Pro Picks Team`)}`;
      window.open(mailto, "_blank");
      setSubmissions((prev) => prev.map((s) => s.id === id ? { ...s, status: "replied", adminReply: replyText } : s));
      setReplyId(null);
      setReplyText("");
    } finally {
      setReplyLoading(false);
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authUser?.isAdmin) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center space-y-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto" />
        <h1 className="text-xl font-bold">Access Restricted</h1>
        <p className="text-sm text-muted-foreground">This page is only accessible to the site owner.</p>
        {authUser?.id && (
          <div className="mt-4 px-4 py-3 rounded-xl border border-border bg-card text-left">
            <p className="text-xs text-muted-foreground mb-1">Your User ID (share with owner to request access):</p>
            <p className="text-xs font-mono text-foreground break-all">{authUser.id}</p>
          </div>
        )}
      </div>
    );
  }

  const newCount = submissions.filter((s) => s.status === "new").length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Owner Dashboard</h1>
            <p className="text-sm text-muted-foreground">Manage users and support submissions</p>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 border-b border-border">
        {([
          { key: "submissions", label: "Help Submissions", icon: MessageSquare, badge: newCount },
          { key: "users", label: "Registered Users", icon: Users, badge: 0 },
        ] as const).map(({ key, label, icon: Icon, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {badge > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 leading-none">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Users tab */}
      {tab === "users" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{users.length} total registered {users.length === 1 ? "user" : "users"}</p>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No users yet.</p>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 text-xs text-muted-foreground">
                    <th className="text-left px-4 py-3 font-medium">Name</th>
                    <th className="text-left px-4 py-3 font-medium">Email</th>
                    <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">User ID</th>
                    <th className="text-left px-4 py-3 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {u.profileImageUrl ? (
                            <img src={u.profileImageUrl} className="h-6 w-6 rounded-full object-cover" alt="" />
                          ) : (
                            <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                              {[u.firstName, u.lastName].filter(Boolean).join("").slice(0, 2).toUpperCase() || "?"}
                            </div>
                          )}
                          <span className="font-medium">{[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground hidden sm:table-cell truncate max-w-[120px]">{u.id}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{timeAgo(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Submissions tab */}
      {tab === "submissions" && (
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : submissions.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">No help submissions yet.</p>
            </div>
          ) : (
            submissions.map((sub) => (
              <div key={sub.id} className={cn(
                "rounded-xl border bg-card p-5 space-y-3 transition-colors",
                sub.status === "new" ? "border-amber-500/30" : "border-border"
              )}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={sub.status} />
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {timeAgo(sub.createdAt)}
                      </span>
                    </div>
                    <p className="font-semibold mt-1.5 text-sm">{sub.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      From: <span className="text-foreground">{sub.name}</span> · {sub.email}
                    </p>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed bg-muted/30 rounded-lg px-3 py-2 whitespace-pre-wrap">
                  {sub.message}
                </p>

                {sub.adminReply && (
                  <div className="border-l-2 border-primary/40 pl-3">
                    <p className="text-xs font-medium text-primary mb-0.5">Your reply:</p>
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{sub.adminReply}</p>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  {sub.status === "new" && (
                    <button
                      onClick={() => markRead(sub.id)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                    >
                      <Eye className="h-3 w-3" />
                      Mark Read
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (replyId === sub.id) { setReplyId(null); } else {
                        setReplyId(sub.id);
                        setReplyText(sub.adminReply ?? "");
                      }
                    }}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <Mail className="h-3 w-3" />
                    {sub.adminReply ? "Edit Reply" : "Reply via Email"}
                  </button>
                </div>

                {replyId === sub.id && (
                  <div className="space-y-2 pt-1">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={4}
                      placeholder={`Hi ${sub.name},\n\nThank you for reaching out...`}
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => sendReply(sub.id)}
                        disabled={!replyText.trim() || replyLoading}
                        className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle className="h-3 w-3" />
                        {replyLoading ? "Opening email…" : "Open in Email App"}
                      </button>
                      <p className="text-xs text-muted-foreground">Opens your email client addressed to {sub.email}</p>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
