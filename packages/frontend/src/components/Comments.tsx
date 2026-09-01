"use client";

import { useState } from "react";
import { MessageSquare, Reply, Edit3, Trash2, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useComments, type Comment } from "@/hooks/useComments";

interface CommentsProps {
  callId: string;
}

export function Comments({ callId }: CommentsProps) {
  const { comments, addComment, editComment, deleteComment, MAX_DEPTH, MAX_CHARS } = useComments(callId);
  const [newComment, setNewComment] = useState("");

  const handleSubmit = () => {
    if (!newComment.trim()) return;
    addComment(newComment.trim());
    setNewComment("");
  };

  return (
    <div className="space-y-4" data-testid="comments-section">
      <h3 className="font-bold flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-primary" />
        Discussion
      </h3>

      {/* New Comment Input */}
      <div className="flex gap-2">
        <textarea
          placeholder="Share your thoughts..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value.slice(0, MAX_CHARS))}
          className="flex-1 bg-secondary/50 border border-border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[80px] resize-none text-sm"
          data-testid="new-comment-input"
        />
        <div className="flex flex-col gap-2">
          <Button onClick={handleSubmit} disabled={!newComment.trim()} size="sm">
            <Send className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground text-center">{newComment.length}/{MAX_CHARS}</span>
        </div>
      </div>

      {/* Comments List */}
      <div className="space-y-3">
        {comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            maxDepth={MAX_DEPTH}
            onReply={(content, parentId) => addComment(content, parentId)}
            onEdit={editComment}
            onDelete={deleteComment}
          />
        ))}
      </div>
    </div>
  );
}

interface CommentItemProps {
  comment: Comment;
  maxDepth: number;
  onReply: (content: string, parentId: string) => void;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
}

function CommentItem({ comment, maxDepth, onReply, onEdit, onDelete }: CommentItemProps) {
  const [isReplying, setIsReplying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [editContent, setEditContent] = useState(comment.content);

  const handleReply = () => {
    if (!replyContent.trim()) return;
    onReply(replyContent.trim(), comment.id);
    setReplyContent("");
    setIsReplying(false);
  };

  const handleEdit = () => {
    if (!editContent.trim()) return;
    onEdit(comment.id, editContent.trim());
    setIsEditing(false);
  };

  const relativeTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div
      className={`${comment.depth > 0 ? "ml-4 pl-4 border-l-2 border-border" : ""}`}
      data-testid={`comment-${comment.id}`}
    >
      <div className="bg-secondary/30 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
            {comment.authorName[0]}
          </div>
          <span className="font-medium">{comment.authorName}</span>
          <span className="text-muted-foreground">{relativeTime(comment.createdAt)}</span>
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full bg-secondary/50 border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              rows={2}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleEdit}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <p className="text-sm">{comment.content}</p>
        )}

        <div className="flex items-center gap-2">
          {comment.depth < maxDepth && (
            <button
              onClick={() => setIsReplying(!isReplying)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Reply className="h-3 w-3" /> Reply
            </button>
          )}
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Edit3 className="h-3 w-3" /> Edit
          </button>
          <button
            onClick={() => onDelete(comment.id)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>

        {isReplying && (
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              placeholder="Write a reply..."
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              className="flex-1 bg-secondary/50 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <Button size="sm" onClick={handleReply} disabled={!replyContent.trim()}>
              <Send className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Render Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="space-y-2 mt-2">
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              maxDepth={maxDepth}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
