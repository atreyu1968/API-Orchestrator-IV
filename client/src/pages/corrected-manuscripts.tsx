import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Save } from "lucide-react";
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
  Layers,
  Merge,
  FileX,
  RefreshCw,
  ChevronDown,
  Microscope,
} from "lucide-react";
import { useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Link } from "wouter";

interface CorrectionDiffStats {
  wordsAdded: number;
  wordsRemoved: number;
  lengthChange: number;
}

interface ResolutionOption {
  id: string;
  type: 'delete' | 'rewrite' | 'merge';
  label: string;
  description: string;
  estimatedTokens?: number;
}

interface StructuralOptions {
  isStructural: boolean;
  options: ResolutionOption[];
  affectedChapters: number[];
  error?: string;
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
  onStructuralResolve,
  isApproving,
  isRejecting,
  isResolving,
  onUpdateTexts
}: { 
  correction: CorrectionRecord;
  manuscriptId: number;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onStructuralResolve: (correctionId: string, optionId: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
  isResolving: boolean;
  onUpdateTexts: (correctionId: string, originalText: string, correctedText: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [structuralOptions, setStructuralOptions] = useState<StructuralOptions | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [checkedStructural, setCheckedStructural] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editOriginal, setEditOriginal] = useState(correction.originalText);
  const [editCorrected, setEditCorrected] = useState(correction.correctedText);
  const isPending = correction.status === 'pending';
  const requiresManualEdit = correction.instruction?.includes('[REQUIERE EDICIÓN MANUAL]') || 
                             correction.originalText?.includes('[Edita manualmente');

  const isStructural = structuralOptions?.isStructural || false;

  useEffect(() => {
    if (isPending && !checkedStructural) {
      checkIfStructural();
    }
  }, [isPending, checkedStructural]);

  const checkIfStructural = async () => {
    try {
      const response = await fetch(`/api/corrected-manuscripts/${manuscriptId}/structural-options/${correction.id}`);
      const data = await response.json();
      setStructuralOptions(data);
      setCheckedStructural(true);
    } catch (error) {
      console.error('Error checking structural status:', error);
      setCheckedStructural(true);
    }
  };

  const loadStructuralOptions = async () => {
    if (structuralOptions || loadingOptions) return;
    setLoadingOptions(true);
    try {
      const response = await fetch(`/api/corrected-manuscripts/${manuscriptId}/structural-options/${correction.id}`);
      const data = await response.json();
      setStructuralOptions(data);
    } catch (error) {
      console.error('Error loading structural options:', error);
    } finally {
      setLoadingOptions(false);
    }
  };

  const getOptionIcon = (type: string) => {
    switch (type) {
      case 'delete': return <FileX className="h-4 w-4 mr-2" />;
      case 'rewrite': return <RefreshCw className="h-4 w-4 mr-2" />;
      case 'merge': return <Merge className="h-4 w-4 mr-2" />;
      default: return null;
    }
  };

  return (
    <Card className={`mb-3 ${isStructural ? 'border-amber-500 dark:border-amber-600' : ''}`} data-testid={`card-correction-${correction.id}`}>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Badge variant={getSeverityColor(correction.severity)} data-testid={`badge-severity-${correction.id}`}>
              {correction.severity}
            </Badge>
            {isStructural && (
              <Badge variant="outline" className="border-amber-500 text-amber-600" data-testid={`badge-structural-${correction.id}`}>
                <Layers className="h-3 w-3 mr-1" />Estructural
              </Badge>
            )}
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
            {correction.status === 'applied' && (
              <Badge className="bg-blue-600" data-testid={`badge-applied-${correction.id}`}>
                <CheckCircle2 className="h-3 w-3 mr-1" />Aplicada
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
          {isStructural && isPending ? (
            <Alert className="mb-4 border-amber-500 bg-amber-50 dark:bg-amber-950/30">
              <Layers className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-700 dark:text-amber-400">Problema Estructural Detectado</AlertTitle>
              <AlertDescription className="text-amber-600 dark:text-amber-300 text-sm">
                Este problema requiere una resolución estructural. La corrección simple no es suficiente.
                Selecciona una opción de resolución abajo.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-muted-foreground">Texto Original:</p>
                  {isPending && !isEditing && (
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="h-6 px-2"
                      onClick={() => setIsEditing(true)}
                      data-testid={`button-edit-${correction.id}`}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Editar
                    </Button>
                  )}
                </div>
                {isEditing ? (
                  <Textarea
                    value={editOriginal}
                    onChange={(e) => setEditOriginal(e.target.value)}
                    className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-sm min-h-[100px]"
                    data-testid={`textarea-original-${correction.id}`}
                  />
                ) : (
                  <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded text-sm border border-red-200 dark:border-red-800" data-testid={`text-original-${correction.id}`}>
                    {correction.originalText || '[No localizado]'}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Texto Corregido:</p>
                {isEditing ? (
                  <Textarea
                    value={editCorrected}
                    onChange={(e) => setEditCorrected(e.target.value)}
                    className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-sm min-h-[100px]"
                    data-testid={`textarea-corrected-${correction.id}`}
                  />
                ) : (
                  <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded text-sm border border-green-200 dark:border-green-800" data-testid={`text-corrected-${correction.id}`}>
                    {correction.correctedText || '[Sin corrección]'}
                  </div>
                )}
              </div>
            </div>
          )}
          
          {isEditing && (
            <div className="flex justify-end gap-2 mt-3">
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => {
                  setIsEditing(false);
                  setEditOriginal(correction.originalText);
                  setEditCorrected(correction.correctedText);
                }}
                data-testid={`button-cancel-edit-${correction.id}`}
              >
                Cancelar
              </Button>
              <Button 
                size="sm"
                onClick={() => {
                  onUpdateTexts(correction.id, editOriginal, editCorrected);
                  setIsEditing(false);
                }}
                data-testid={`button-save-edit-${correction.id}`}
              >
                <Save className="h-3 w-3 mr-1" />
                Guardar
              </Button>
            </div>
          )}
          
          <div className="flex items-center justify-between mt-4">
            <div className="flex gap-2 text-xs text-muted-foreground" data-testid={`text-diff-stats-${correction.id}`}>
              {!isStructural && (
                <>
                  <span>+{correction.diffStats.wordsAdded} palabras</span>
                  <span>-{correction.diffStats.wordsRemoved} palabras</span>
                  <span>({correction.diffStats.lengthChange > 0 ? '+' : ''}{correction.diffStats.lengthChange} caracteres)</span>
                </>
              )}
            </div>
            
            {isPending && (
              <div className="flex gap-2">
                {isStructural ? (
                  <DropdownMenu onOpenChange={(open) => open && loadStructuralOptions()}>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        size="sm" 
                        className="bg-amber-600"
                        disabled={isResolving}
                        data-testid={`button-structural-options-${correction.id}`}
                      >
                        {isResolving ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <Layers className="h-4 w-4 mr-1" />
                        )}
                        Resolver Problema
                        <ChevronDown className="h-4 w-4 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-80">
                      <DropdownMenuLabel>Opciones de Resolución</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {loadingOptions ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Cargando opciones...
                        </div>
                      ) : structuralOptions?.isStructural ? (
                        structuralOptions.options.map((option) => (
                          <DropdownMenuItem 
                            key={option.id}
                            onClick={() => onStructuralResolve(correction.id, option.id)}
                            className="flex flex-col items-start py-3 cursor-pointer"
                            data-testid={`menu-item-${option.id}`}
                          >
                            <div className="flex items-center font-medium">
                              {getOptionIcon(option.type)}
                              {option.label}
                            </div>
                            <span className="text-xs text-muted-foreground ml-6 mt-1">
                              {option.description}
                            </span>
                            {option.estimatedTokens && (
                              <span className="text-xs text-amber-600 ml-6">
                                ~{option.estimatedTokens} tokens
                              </span>
                            )}
                          </DropdownMenuItem>
                        ))
                      ) : (
                        <div className="py-2 px-3 text-sm text-muted-foreground">
                          {structuralOptions?.error || "No se encontraron opciones de resolución"}
                        </div>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <>
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
                  </>
                )}
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
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const corrections = manuscript.pendingCorrections || [];
  const pendingCount = corrections.filter(c => c.status === 'pending').length;
  const approvedCount = corrections.filter(c => c.status === 'approved' || c.status === 'applied').length;
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

  const structuralResolveMutation = useMutation({
    mutationFn: async ({ correctionId, optionId }: { correctionId: string; optionId: string }) => {
      setResolvingId(correctionId);
      const res = await apiRequest('POST', `/api/corrected-manuscripts/${manuscript.id}/structural-resolve/${correctionId}`, { optionId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/corrected-manuscripts', manuscript.id] });
      toast({ title: "Resolución aplicada", description: "El problema estructural ha sido resuelto." });
      setResolvingId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setResolvingId(null);
    }
  });

  const handleStructuralResolve = (correctionId: string, optionId: string) => {
    structuralResolveMutation.mutate({ correctionId, optionId });
  };

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

  const updateTextsMutation = useMutation({
    mutationFn: async ({ id, original, corrected }: { id: string; original: string; corrected: string }) => {
      const res = await apiRequest('PATCH', `/api/corrected-manuscripts/${manuscript.id}/update-texts/${id}`, { 
        originalText: original, 
        correctedText: corrected 
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/corrected-manuscripts', manuscript.id] });
      toast({ title: "Textos actualizados" });
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
          <Download className="h-4 w-4 mr-2" /> Descargar MD
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
                  onStructuralResolve={handleStructuralResolve}
                  onUpdateTexts={(id, original, corrected) => updateTextsMutation.mutate({ id, original, corrected })}
                  isApproving={approvingId === correction.id}
                  isRejecting={rejectingId === correction.id}
                  isResolving={resolvingId === correction.id}
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

  const [, navigate] = useLocation();
  
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
  
  const reAuditMutation = useMutation({
    mutationFn: async (projectId: number) => {
      const res = await apiRequest('POST', `/api/projects/${projectId}/start-audit`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Auditoría iniciada", description: "Redirigiendo al auditor..." });
      navigate('/auditor');
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
                      title="Descargar Manuscrito MD"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`/api/corrected-manuscripts/${manuscript.id}/download`, '_blank');
                      }}
                      data-testid={`button-download-${manuscript.id}`}
                    >
                      <Download className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button 
                      size="icon" 
                      variant="ghost"
                      title="Re-Auditar Manuscrito"
                      onClick={(e) => {
                        e.stopPropagation();
                        reAuditMutation.mutate(manuscript.projectId);
                      }}
                      disabled={reAuditMutation.isPending}
                      data-testid={`button-reaudit-${manuscript.id}`}
                    >
                      {reAuditMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Microscope className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                    <Button 
                      size="icon" 
                      variant="ghost"
                      title="Eliminar Manuscrito"
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
