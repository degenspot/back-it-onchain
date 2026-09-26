'use client';

import * as React from 'react';
import { Check, MessageSquare, Reply, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react';
import { EvidencePreview } from '@/src/components/EvidencePreview';
import { cn } from '@/lib/utils';

export type DisputeVote = 'valid' | 'invalid';

export interface DisputeComment {
  id: string;
  parentId: string | null;
  author: string;
  authorName?: string;
  body: string;
  createdAt: string;
  counterCallId?: string;
  counterCallLabel?: string;
  evidenceCid?: string;
  evidenceTitle?: string;
  evidenceMimeType?: string;
  votes?: Record<DisputeVote, number>;
}

export interface DisputeThreadProps {
  callId: string;
  comments?: DisputeComment[];
  onSubmitComment?: (body: string, parentId: string | null, evidenceCid?: string) => Promise<void> | void;
  onVote?: (commentId: string, vote: DisputeVote) => Promise<void> | void;
  socket?: {
    on: (event: string, handler: (payload: unknown) => void) => void;
    off: (event: string, handler?: (payload: unknown) => void) => void;
  };
}

const MAX_DEPTH = 5;

function childComments(comments: DisputeComment[], parentId: string | null): DisputeComment[] {
  return comments.filter((comment) => comment.parentId === parentId);
}

function displayAuthor(comment: DisputeComment): string {
  return comment.authorName || comment.author || 'Anonymous';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function DisputeThread({ callId, comments: providedComments = [], onSubmitComment, onVote, socket }: DisputeThreadProps) {
  const [comments, setComments] = React.useState<DisputeComment[]>(providedComments);
  const [body, setBody] = React.useState('');
  const [evidenceCid, setEvidenceCid] = React.useState('');
  const [replyTo, setReplyTo] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [localVotes, setLocalVotes] = React.useState<Record<string, DisputeVote>>({});

  React.useEffect(() => setComments(providedComments), [providedComments]);

  React.useEffect(() => {
    if (!socket) return;
    const handleUpdate = (payload: unknown) => {
      const data = payload as { comment?: DisputeComment; comments?: DisputeComment[] };
      if (Array.isArray(data.comments)) setComments(data.comments);
      else if (data.comment) {
        setComments((current) => current.some((comment) => comment.id === data.comment?.id)
          ? current.map((comment) => comment.id === data.comment?.id ? data.comment as DisputeComment : comment)
          : [...current, data.comment as DisputeComment]);
      }
    };
    socket.on('disputeThreadUpdated', handleUpdate);
    socket.on('disputeRaised', handleUpdate);
    return () => {
      socket.off('disputeThreadUpdated', handleUpdate);
      socket.off('disputeRaised', handleUpdate);
    };
  }, [socket]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = body.trim();
    if (!content || isSubmitting) return;
    setIsSubmitting(true);
    const comment: DisputeComment = {
      id: `local-${Date.now()}`,
      parentId: replyTo,
      author: 'current-user',
      authorName: 'You',
      body: content,
      createdAt: new Date().toISOString(),
      evidenceCid: evidenceCid.trim() || undefined,
      evidenceTitle: 'IPFS evidence',
    };
    try {
      await onSubmitComment?.(content, replyTo, comment.evidenceCid);
      setComments((current) => [...current, comment]);
      setBody('');
      setEvidenceCid('');
      setReplyTo(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const vote = async (commentId: string, value: DisputeVote) => {
    if (localVotes[commentId]) return;
    setLocalVotes((current) => ({ ...current, [commentId]: value }));
    await onVote?.(commentId, value);
  };

  const renderComment = (comment: DisputeComment, depth: number): React.ReactNode => {
    const children = childComments(comments, comment.id);
    const score = comment.votes || { valid: 0, invalid: 0 };
    return (
      <li key={comment.id} className={cn('space-y-3', depth > 0 && 'ml-4 border-l-2 border-border pl-3')}>
        <article className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{displayAuthor(comment)}</span>
            <span>{formatDate(comment.createdAt)}</span>
            {comment.counterCallId ? <span className="rounded-full bg-secondary px-2 py-0.5">Counter-call {comment.counterCallLabel || comment.counterCallId}</span> : null}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{comment.body}</p>
          {comment.evidenceCid ? <EvidencePreview className="mt-3" cid={comment.evidenceCid} mimeType={comment.evidenceMimeType} title={comment.evidenceTitle} /> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {depth < MAX_DEPTH ? (
              <button type="button" onClick={() => setReplyTo(comment.id)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <Reply className="h-3.5 w-3.5" /> Reply
              </button>
            ) : null}
            <button type="button" onClick={() => void vote(comment.id, 'valid')} disabled={Boolean(localVotes[comment.id])} className="inline-flex items-center gap-1 text-muted-foreground hover:text-green-500 disabled:opacity-50">
              <ThumbsUp className="h-3.5 w-3.5" /> {score.valid}
            </button>
            <button type="button" onClick={() => void vote(comment.id, 'invalid')} disabled={Boolean(localVotes[comment.id])} className="inline-flex items-center gap-1 text-muted-foreground hover:text-red-500 disabled:opacity-50">
              <ThumbsDown className="h-3.5 w-3.5" /> {score.invalid}
            </button>
            {localVotes[comment.id] ? <span className="text-green-500"><Check className="h-3.5 w-3.5" /> Vote recorded</span> : null}
          </div>
        </article>
        {children.length > 0 ? <ol className="space-y-3">{children.map((child) => renderComment(child, depth + 1))}</ol> : null}
      </li>
    );
  };

  const roots = childComments(comments, null);

  return (
    <section className="space-y-4" data-testid={`dispute-thread-${callId}`}>
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">Dispute discussion</h2>
        <span className="text-xs text-muted-foreground">Up to {MAX_DEPTH} levels</span>
      </div>
      <form onSubmit={submit} className="space-y-2 rounded-xl border border-border bg-card p-3">
        {replyTo ? <p className="text-xs text-muted-foreground">Replying to a comment · <button type="button" onClick={() => setReplyTo(null)} className="underline">Cancel</button></p> : null}
        <label htmlFor="dispute-comment" className="sr-only">Add dispute comment</label>
        <textarea id="dispute-comment" value={body} onChange={(event) => setBody(event.target.value.slice(0, 2000))} placeholder="Share evidence or explain the counter-call…" className="min-h-24 w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex-1 text-xs text-muted-foreground">IPFS CID <input value={evidenceCid} onChange={(event) => setEvidenceCid(event.target.value)} placeholder="Optional evidence CID" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary" /></label>
          <button type="submit" disabled={!body.trim() || isSubmitting} className="self-end rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">Post comment</button>
        </div>
      </form>
      {roots.length > 0 ? <ol className="space-y-3">{roots.map((comment) => renderComment(comment, 0))}</ol> : <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No dispute comments yet.</p>}
      <p className="flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Evidence links are limited to HTTPS sources and external content is never rendered as HTML.</p>
    </section>
  );
}
