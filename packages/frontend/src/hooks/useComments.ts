import { useState, useCallback } from "react";

export interface Comment {
  id: string;
  callId: string;
  parentId: string | null;
  author: string;
  authorName: string;
  content: string;
  createdAt: string;
  depth: number;
  replies?: Comment[];
}

const MOCK_COMMENTS: Comment[] = [
  {
    id: "1", callId: "1", parentId: null, author: "0x1111", authorName: "Trader1",
    content: "This thesis makes sense given the macro environment.", createdAt: "2025-01-15T10:00:00Z", depth: 0,
    replies: [
      {
        id: "2", callId: "1", parentId: "1", author: "0x2222", authorName: "Analyst2",
        content: "Agreed, but I'd watch the support level at $45k.", createdAt: "2025-01-15T11:30:00Z", depth: 1,
      },
    ],
  },
  {
    id: "3", callId: "1", parentId: null, author: "0x3333", authorName: "Skeptic3",
    content: "Not convinced. The halving cycle data suggests otherwise.", createdAt: "2025-01-15T12:00:00Z", depth: 0,
  },
];

const MAX_DEPTH = 3;
const MAX_CHARS = 300;

export function useComments(callId: string) {
  const [comments, setComments] = useState<Comment[]>(MOCK_COMMENTS);
  const [isLoading, setIsLoading] = useState(false);

  const addComment = useCallback((content: string, parentId: string | null = null) => {
    if (content.length > MAX_CHARS) return;
    const newComment: Comment = {
      id: String(Date.now()),
      callId,
      parentId,
      author: "0xCurrentUser",
      authorName: "You",
      content,
      createdAt: new Date().toISOString(),
      depth: parentId ? 1 : 0,
    };
    setComments(prev => [...prev, newComment]);
  }, [callId]);

  const editComment = useCallback((id: string, content: string) => {
    if (content.length > MAX_CHARS) return;
    setComments(prev =>
      prev.map(c => c.id === id ? { ...c, content } : c)
    );
  }, []);

  const deleteComment = useCallback((id: string) => {
    setComments(prev => prev.filter(c => c.id !== id && c.parentId !== id));
  }, []);

  const buildTree = useCallback((flat: Comment[]): Comment[] => {
    const map = new Map<string, Comment>();
    const roots: Comment[] = [];
    flat.forEach(c => map.set(c.id, { ...c, replies: [] }));
    flat.forEach(c => {
      const node = map.get(c.id)!;
      if (c.parentId && map.has(c.parentId)) {
        map.get(c.parentId)!.replies!.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }, []);

  const threadedComments = buildTree(comments);

  return {
    comments: threadedComments,
    addComment,
    editComment,
    deleteComment,
    isLoading,
    MAX_DEPTH,
    MAX_CHARS,
  };
}
