import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Scissors, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Download,
  Trash2,
  Eye,
  ThumbsUp,
  ThumbsDown,
  FileCheck,
  ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

interface CorrectionDiffStats {
  wordsAdded: number;
  wordsRemoved: number;
  lengthChange: number;
}

interface CorrectionRecord {
  id: string;
  issueId: string;
  location: string;
  chapterNumber: number;
  originalText: string;
  correctedText: string;
  instruction: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  diffStats: CorrectionDiffStats;
  createdAt: string;
  reviewedAt?: string;
}

interface CorrectedManuscript {
  id: number;
  auditId: number;
  projectId: number;
  status: string;
  originalContent: string;
  correctedContent: string | null;
  pendingCorrections: CorrectionRecord[];
  totalIssues: number | null;
  correctedIssues: number | null;
  approvedIssues: number | null;
  rejectedIssues: number | null;
  createdAt: string;
  completedAt: string | null;
  projectTitle?: string;
}

function getSeverityColor(severity: string) {
  switch (severity) {
    case 'CRITICAL': return 'destructive';
    case 'HIGH': return 'destructive';
    case 'MEDIUM': return 'secondary';
    case 'LOW': return 'outline';
    default: return 'outline';
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'pending':
      return <Badge variant="secondary" data-testid="badge-status-pending">Pendiente</Badge>;
    case 'correcting':
      return <Badge variant="secondary" data-testid="badge-status-correcting"><Loader2 className="h-3 w-3 animate-spin mr-1" />Corrigiendo</Badge>;
    case 'review':
      return <Badge variant="default" data-testid="badge-status-review">En Revisión</Badge>;
    case 'approved':
      return <Badge className="bg-green-600" data-testid="badge-status-approved">Aprobado</Badge>;
    case 'error':
      return <Badge variant="destructive" data-testid="badge-status-error">Error</Badge>;
    default:
      return <Badge variant="outline" data-testid="badge-status-unknown">{status}</Badge>;
  }
}

function CorrectionCard({ 
  correction, 
  manuscriptId,
  onApprove,
  onReject,
  isApproving,
  isRejecting
}: { 
  correction: CorrectionRecord;
  manuscriptId: number;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPending = correction.status === 'pending';

  return (
    <Card className="mb-3" data-testid={`card-correction-${correction.id}`}>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Badge variant={getSeverityColor(correction.severity)} data-testid={`badge-severity-${correction.id}`}>
              {correction.severity}
            </Badge>
            <span className="text-sm text-muted-foreground truncate" data-testid={`text-location-${correction.id}`}>
              {correction.location}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {correction.status === 'approved' && (
              <Badge className="bg-green-600" data-testid={`badge-approved-${correction.id}`}>
                <CheckCircle2 className="h-3 w-3 mr-1" />Aprobada
              </Badge>
            )}
            {correction.status === 'rejected' && (
              <Badge variant="destructive" data-testid={`badge-rejected-${correction.id}`}>
                <XCircle className="h-3 w-3 mr-1" />Rechazada
              </Badge>
            )}
            <Button 
              size="icon" 
              variant="ghost" 
              onClick={() => setExpanded(!expanded)}
              data-testid={`button-expand-${correction.id}`}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs mt-1" data-testid={`text-instruction-${correction.id}`}>
          {correction.instruction}
        </CardDescription>
      </CardHeader>
      
      {expanded && (
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Texto Original:</p>
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded text-sm border border-red-200 dark:border-red-800" data-testid={`text-original-${correction.id}`}>
                {correction.originalText || '[No localizado]'}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Texto Corregido:</p>
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded text-sm border border-green-200 dark:border-green-800" data-testid={`text-corrected-${correction.id}`}>
                {correction.correctedText || '[Sin corrección]'}
              </div>
            </div>
          </div>
          
          <div className="flex items-center justify-between mt-4">
            <div className="flex gap-2 text-xs text-muted-foreground" data-testid={`text-diff-stats-${correction.id}`}>
              <span>+{correction.diffStats.wordsAdded} palabras</span>
              <span>-{correction.diffStats.wordsRemoved} palabras</span>
              <span>({correction.diffStats.lengthChange > 0 ? '+' : ''}{correction.diffStats.lengthChange} caracteres)</span>
            </div>
            
            {isPending && (
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => onReject(correction.id)}
                  disabled={isRejecting}
                  data-testid={`button-reject-${correction.id}`}
                >
                  {isRejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsDown className="h-4 w-4 mr-1" />}
                  Rechazar
                </Button>
                <Button 
                  size="sm"
                  onClick={() => onApprove(correction.id)}
                  disabled={isApproving}
                  data-testid={`button-approve-${correction.id}`}
                >
                  {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4 mr-1" />}
                  Aprobar
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function ManuscriptDetail({ manuscript, onBack }: { manuscript: CorrectedManuscript; onBack: () => void }) {
  const { toast } = useToast();
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const corrections = manuscript.pendingCorrections || [];
  const pendingCount = corrections.filter(c => c.status === 'pending').length;
  const approvedCount = corrections.filter(c => c.status === 'approved').length;
  const rejectedCount = corrections.filter(c => c.status === 'rejected').length;

  const approveMutation = useMutation({
    mutationFn: async (correctionId: string) => {
      setApprovingId(correctionId);
      const res = await apiRequest('POST', `/api/corrected-manuscripts/${manuscript.id}/approve/${correctionId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/corrected-manuscripts', manuscript.id] });
      toast({ title: "Corrección aprobada" });
      setApprovingId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setApprovingId(null);
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async (correctionId: string) => {
      setRejectingId(correctionId);
      const res = await apiRequest('POST', `/api/corrected-manuscripts/${manuscript.id}/reject/${correctionId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/corrected-manuscripts', manuscript.id] });
      toast({ title: "Corrección rechazada" });
      setRejectingId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setRejectingId(null);
    }
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/corrected-manuscripts/${manuscript.id}/finalize`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/corrected-manuscripts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/corrected-manuscripts', manuscript.id] });
      toast({ title: "Manuscrito finalizado", description: "El manuscrito ha sido aprobado." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <h2 className="text-xl font-bold" data-testid="text-manuscript-title">{manuscript.projectTitle || 'Manuscrito'}</h2>
        {getStatusBadge(manuscript.status)}
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold" data-testid="text-total-issues">{manuscript.totalIssues || 0}</div>
            <p className="text-xs text-muted-foreground">Total Issues</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-yellow-600" data-testid="text-pending-count">{pendingCount}</div>
            <p className="text-xs text-muted-foreground">Pendientes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600" data-testid="text-approved-count">{approvedCount}</div>
            <p className="text-xs text-muted-foreground">Aprobadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-600" data-testid="text-rejected-count">{rejectedCount}</div>
            <p className="text-xs text-muted-foreground">Rechazadas</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        <Button 
          variant="outline"
          onClick={() => window.open(`/api/corrected-manuscripts/${manuscript.id}/download`, '_blank')}
          data-testid="button-download"
        >
          <Download className="h-4 w-4 mr-2" /> Descargar Manuscrito
        </Button>
        {manuscript.status === 'review' && pendingCount === 0 && (
          <Button 
            onClick={() => finalizeMutation.mutate()}
            disabled={finalizeMutation.isPending}
            data-testid="button-finalize"
          >
            {finalizeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileCheck className="h-4 w-4 mr-2" />}
            Finalizar Manuscrito
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Correcciones</CardTitle>
          <CardDescription>
            Revisa y aprueba o rechaza cada corrección propuesta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            {corrections.length === 0 ? (
              <p className="text-muted-foreground text-center py-8" data-testid="text-no-corrections">
                No hay correcciones para mostrar.
              </p>
            ) : (
              corrections.map((correction) => (
                <CorrectionCard
                  key={correction.id}
                  correction={correction}
                  manuscriptId={manuscript.id}
                  onApprove={(id) => approveMutation.mutate(id)}
                  onReject={(id) => rejectMutation.mutate(id)}
                  isApproving={approvingId === correction.id}
                  isRejecting={rejectingId === correction.id}
                />
              ))
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CorrectedManuscriptsPage() {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: manuscripts = [], isLoading } = useQuery<CorrectedManuscript[]>({
    queryKey: ['/api/corrected-manuscripts'],
  });

  const { data: selectedManuscript } = useQuery<CorrectedManuscript>({
    queryKey: ['/api/corrected-manuscripts', selectedId],
    enabled: !!selectedId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest('DELETE', `/api/corrected-manuscripts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/corrected-manuscripts'] });
      toast({ title: "Manuscrito eliminado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  if (selectedManuscript) {
    return (
      <div className="p-6">
        <ManuscriptDetail 
          manuscript={selectedManuscript} 
          onBack={() => setSelectedId(null)} 
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Scissors className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Manuscritos Corregidos</h1>
            <p className="text-muted-foreground">
              Correcciones quirúrgicas aplicadas por DeepSeek
            </p>
          </div>
        </div>
        <Link href="/auditor">
          <Button variant="outline" data-testid="button-go-auditor">
            <ArrowLeft className="h-4 w-4 mr-2" /> Volver al Auditor
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : manuscripts.length === 0 ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Sin manuscritos corregidos</AlertTitle>
          <AlertDescription>
            No hay manuscritos corregidos aún. Primero ejecuta una auditoría y luego inicia el proceso de corrección.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4">
          {manuscripts.map((manuscript) => (
            <Card 
              key={manuscript.id} 
              className="hover-elevate cursor-pointer"
              onClick={() => setSelectedId(manuscript.id)}
              data-testid={`card-manuscript-${manuscript.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg" data-testid={`text-title-${manuscript.id}`}>
                    {manuscript.projectTitle || `Proyecto #${manuscript.projectId}`}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(manuscript.status)}
                    <Button 
                      size="icon" 
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(manuscript.id);
                      }}
                      data-testid={`button-delete-${manuscript.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
                <CardDescription data-testid={`text-date-${manuscript.id}`}>
                  {new Date(manuscript.createdAt).toLocaleString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6 text-sm">
                  <div data-testid={`text-stats-total-${manuscript.id}`}>
                    <span className="text-muted-foreground">Issues: </span>
                    <span className="font-medium">{manuscript.totalIssues || 0}</span>
                  </div>
                  <div data-testid={`text-stats-corrected-${manuscript.id}`}>
                    <span className="text-muted-foreground">Corregidas: </span>
                    <span className="font-medium text-green-600">{manuscript.approvedIssues || 0}</span>
                  </div>
                  <div data-testid={`text-stats-rejected-${manuscript.id}`}>
                    <span className="text-muted-foreground">Rechazadas: </span>
                    <span className="font-medium text-red-600">{manuscript.rejectedIssues || 0}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
