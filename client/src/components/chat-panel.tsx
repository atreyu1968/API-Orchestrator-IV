import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, MessageSquare, Plus, Trash2, X, BookOpen, PenTool } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { ChatSession, ChatMessage } from "@shared/models/chat";

interface ChatPanelProps {
  agentType: "architect" | "reeditor";
  projectId?: number;
  reeditProjectId?: number;
  chapterNumber?: number;
  className?: string;
  onClose?: () => void;
}

export function ChatPanel({
  agentType,
  projectId,
  reeditProjectId,
  chapterNumber,
  className,
  onClose,
}: ChatPanelProps) {
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sessionsQueryKey = projectId
    ? ["/api/chat/sessions", { projectId, agentType }]
    : ["/api/chat/sessions", { reeditProjectId, agentType }];

  const { data: sessions = [], isLoading: loadingSessions } = useQuery<ChatSession[]>({
    queryKey: sessionsQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId.toString());
      if (reeditProjectId) params.set("reeditProjectId", reeditProjectId.toString());
      params.set("agentType", agentType);
      const res = await fetch(`/api/chat/sessions?${params}`);
      if (!res.ok) throw new Error("Failed to fetch sessions");
      return res.json();
    },
  });

  const messagesQueryKey = ["/api/chat/sessions", activeSessionId, "messages"];
  const { data: messages = [], isLoading: loadingMessages } = useQuery<ChatMessage[]>({
    queryKey: messagesQueryKey,
    queryFn: async () => {
      if (!activeSessionId) return [];
      const res = await fetch(`/api/chat/sessions/${activeSessionId}/messages`);
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!activeSessionId,
  });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = { agentType };
      if (projectId) body.projectId = projectId;
      if (reeditProjectId) body.reeditProjectId = reeditProjectId;
      if (chapterNumber !== undefined) body.chapterNumber = chapterNumber;
      body.title = `${agentType === "architect" ? "Arquitecto" : "Reeditor"} - ${new Date().toLocaleDateString()}`;
      
      const res = await apiRequest("POST", "/api/chat/sessions", body);
      return res.json();
    },
    onSuccess: (session: ChatSession) => {
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      setActiveSessionId(session.id);
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: number) => {
      await apiRequest("DELETE", `/api/chat/sessions/${sessionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      if (sessions.length > 1) {
        const remainingSessions = sessions.filter(s => s.id !== activeSessionId);
        setActiveSessionId(remainingSessions[0]?.id || null);
      } else {
        setActiveSessionId(null);
      }
    },
  });

  useEffect(() => {
    setActiveSessionId(null);
    setInputValue("");
    setIsStreaming(false);
    setStreamingContent("");
  }, [projectId, reeditProjectId]);

  useEffect(() => {
    if (sessions.length > 0 && !activeSessionId) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || !activeSessionId || isStreaming) return;
    
    const messageText = inputValue.trim();
    setInputValue("");
    setIsStreaming(true);
    setStreamingContent("");

    const tempUserMessage: ChatMessage = {
      id: -1,
      sessionId: activeSessionId,
      role: "user",
      content: messageText,
      chapterReference: null,
      metadata: null,
      inputTokens: 0,
      outputTokens: 0,
      createdAt: new Date(),
    };

    queryClient.setQueryData<ChatMessage[]>(messagesQueryKey, (old = []) => [...old, tempUserMessage]);

    try {
      const url = `/api/chat/sessions/${activeSessionId}/stream?message=${encodeURIComponent(messageText)}`;
      const eventSource = new EventSource(url);
      let fullContent = "";

      eventSource.addEventListener("chunk", (event) => {
        const data = JSON.parse(event.data);
        fullContent += data.text;
        setStreamingContent(fullContent);
      });

      eventSource.addEventListener("complete", (event) => {
        const data = JSON.parse(event.data);
        eventSource.close();
        setIsStreaming(false);
        setStreamingContent("");
        queryClient.invalidateQueries({ queryKey: messagesQueryKey });
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      });

      eventSource.addEventListener("error", (event: any) => {
        eventSource.close();
        setIsStreaming(false);
        setStreamingContent("");
        console.error("Chat stream error:", event);
      });

      eventSource.onerror = () => {
        eventSource.close();
        setIsStreaming(false);
        setStreamingContent("");
      };
    } catch (error) {
      console.error("Failed to send message:", error);
      setIsStreaming(false);
      setStreamingContent("");
    }
  }, [inputValue, activeSessionId, isStreaming, queryClient, messagesQueryKey, sessionsQueryKey]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const agentIcon = agentType === "architect" ? BookOpen : PenTool;
  const AgentIcon = agentIcon;
  const agentLabel = agentType === "architect" ? "Arquitecto" : "Reeditor";
  const agentDescription = agentType === "architect" 
    ? "Asistente de estructura narrativa y desarrollo de historia"
    : "Asistente de corrección y mejora de manuscritos";

  return (
    <Card className={cn("flex flex-col h-full", className)} data-testid="chat-panel">
      <div className="flex items-center justify-between gap-2 p-3 border-b">
        <div className="flex items-center gap-2">
          <AgentIcon className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">{agentLabel}</h3>
            <p className="text-xs text-muted-foreground">{agentDescription}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending}
            data-testid="button-new-chat"
          >
            <Plus className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-chat">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {sessions.length > 1 && (
        <div className="flex gap-1 p-2 border-b overflow-x-auto">
          {sessions.map((session) => (
            <Badge
              key={session.id}
              variant={session.id === activeSessionId ? "default" : "outline"}
              className="cursor-pointer whitespace-nowrap"
              onClick={() => setActiveSessionId(session.id)}
              data-testid={`badge-session-${session.id}`}
            >
              {session.title}
            </Badge>
          ))}
        </div>
      )}

      <ScrollArea className="flex-1 p-3">
        {loadingSessions || loadingMessages ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <MessageSquare className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">
              Inicia una conversación con el {agentLabel.toLowerCase()}
            </p>
            <Button
              onClick={() => createSessionMutation.mutate()}
              disabled={createSessionMutation.isPending}
              data-testid="button-start-chat"
            >
              {createSessionMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Nueva conversación
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-2",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
                data-testid={`message-${message.id}`}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  <div className="whitespace-pre-wrap">{message.content}</div>
                </div>
              </div>
            ))}
            {isStreaming && streamingContent && (
              <div className="flex gap-2 justify-start" data-testid="message-streaming">
                <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-muted">
                  <div className="whitespace-pre-wrap">{streamingContent}</div>
                </div>
              </div>
            )}
            {isStreaming && !streamingContent && (
              <div className="flex gap-2 justify-start">
                <div className="rounded-lg px-3 py-2 bg-muted">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {activeSessionId && (
        <div className="p-3 border-t">
          <div className="flex gap-2">
            <Textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                agentType === "architect"
                  ? "Pregunta sobre la estructura, personajes, trama..."
                  : "Describe el problema o corrección que necesitas..."
              }
              className="resize-none min-h-[60px]"
              disabled={isStreaming}
              data-testid="input-chat-message"
            />
            <Button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isStreaming}
              className="self-end"
              data-testid="button-send-message"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          {activeSessionId && sessions.length > 0 && (
            <div className="flex justify-end mt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteSessionMutation.mutate(activeSessionId)}
                disabled={deleteSessionMutation.isPending}
                className="text-destructive hover:text-destructive"
                data-testid="button-delete-session"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Eliminar conversación
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
