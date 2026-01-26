import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Users, BookOpen, Shield, Heart, Skull, GitBranch, Activity } from "lucide-react";
import type { WorldBible, Character, TimelineEvent, WorldRule, PlotOutline } from "@shared/schema";

// Helper function to safely convert any value to a displayable string
// Handles objects with keys like {tipo, numero, descripcion, elementos_sensoriales, etc.}
function safeStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    // Handle objects with common keys from AI-generated content
    const obj = value as Record<string, unknown>;
    if ('descripcion' in obj && typeof obj.descripcion === 'string') {
      return obj.descripcion;
    }
    if ('description' in obj && typeof obj.description === 'string') {
      return obj.description;
    }
    if ('event' in obj && typeof obj.event === 'string') {
      return obj.event;
    }
    if ('name' in obj && typeof obj.name === 'string') {
      return obj.name;
    }
    if ('texto' in obj && typeof obj.texto === 'string') {
      return obj.texto;
    }
    // Fallback: try to create a readable summary
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  return String(value);
}

interface PlotDecision {
  decision: string;
  capitulo_establecido: number;
  capitulos_afectados: number[];
  consistencia_actual: "consistente" | "inconsistente";
  problema?: string;
}

interface PersistentInjury {
  personaje: string;
  tipo_lesion: string;
  capitulo_ocurre: number;
  efecto_esperado: string;
  capitulos_verificados: number[];
  consistencia: "mantenida" | "ignorada";
  problema?: string;
}

interface WorldBibleDisplayProps {
  worldBible: WorldBible | null;
}

function TimelineTab({ events }: { events: TimelineEvent[] }) {
  if (!events || events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Clock className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">Sin eventos en la línea temporal</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="relative pl-6 pr-4 space-y-4">
        <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-border" />
        {events.map((event, index) => {
          const eventAny = event as any;
          const chapterNum = event.chapter || eventAny.number || index + 1;
          const eventText = event.event || eventAny.title || eventAny.summary || "";
          const characters = event.characters || [];
          const keyEvents = eventAny.keyEvents || [];
          const significance = event.significance || (keyEvents.length > 0 ? keyEvents[0] : null);

          return (
            <div key={index} className="relative" data-testid={`timeline-event-${index}`}>
              <div className="absolute -left-4 top-1.5 w-3 h-3 rounded-full bg-primary border-2 border-background" />
              <div className="bg-card border border-card-border rounded-md p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className="text-xs">Cap. {chapterNum}</Badge>
                  <span className="text-sm font-medium">{safeStringify(eventText)}</span>
                </div>
                {characters.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {characters.map((char: string, i: number) => (
                      <Badge key={i} className="text-xs bg-chart-1/10 text-chart-1">{safeStringify(char)}</Badge>
                    ))}
                  </div>
                )}
                {significance && (
                  <p className="text-xs text-muted-foreground mt-2 italic">{safeStringify(significance)}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function CharactersTab({ characters }: { characters: Character[] }) {
  if (!characters || characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Users className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">Sin personajes definidos</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="grid gap-3 pr-4">
        {characters.map((character, index) => {
          // Support both v1 (psychologicalProfile) and v2 (profile) formats
          const charAny = character as any;
          const profileText = character.psychologicalProfile || charAny.profile || "";
          const appearance = charAny.appearance as { eyes?: string; hair?: string; distinguishing_features?: string[] } | undefined;
          const isAlive = character.isAlive !== false;
          
          return (
            <Card key={index} data-testid={`character-card-${index}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    {character.name}
                    {!isAlive && <Skull className="h-4 w-4 text-destructive" />}
                  </CardTitle>
                  <Badge variant="outline" className="text-xs">{character.role}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {profileText && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                      Perfil
                    </p>
                    <p className="text-sm text-foreground">{safeStringify(profileText)}</p>
                  </div>
                )}
                {character.arc && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                      Arco del Personaje
                    </p>
                    <p className="text-sm text-foreground">{safeStringify(character.arc)}</p>
                  </div>
                )}
                {appearance && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                      Apariencia
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {appearance.eyes && (
                        <Badge variant="secondary" className="text-xs">Ojos: {appearance.eyes}</Badge>
                      )}
                      {appearance.hair && (
                        <Badge variant="secondary" className="text-xs">Cabello: {appearance.hair}</Badge>
                      )}
                    </div>
                    {appearance.distinguishing_features && appearance.distinguishing_features.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {appearance.distinguishing_features.map((feature, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{feature}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {character.relationships && character.relationships.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    <Heart className="h-3.5 w-3.5 text-muted-foreground mr-1" />
                    {character.relationships.map((rel, i) => {
                      const displayText = typeof rel === 'string' 
                        ? rel 
                        : typeof rel === 'object' && rel !== null
                          ? (rel as { con?: string; tipo?: string }).con 
                            ? `${(rel as { con: string; tipo?: string }).con}${(rel as { tipo?: string }).tipo ? ` (${(rel as { tipo: string }).tipo})` : ''}`
                            : JSON.stringify(rel)
                          : String(rel);
                      return (
                        <Badge key={i} variant="secondary" className="text-xs">{displayText}</Badge>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function WorldRulesTab({ rules }: { rules: WorldRule[] }) {
  if (!rules || rules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Shield className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">Sin reglas del mundo definidas</p>
      </div>
    );
  }

  const groupedRules = rules.reduce((acc, rule) => {
    const category = rule.category || "General";
    if (!acc[category]) acc[category] = [];
    acc[category].push(rule);
    return acc;
  }, {} as Record<string, WorldRule[]>);

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-4 pr-4">
        {Object.entries(groupedRules).map(([category, categoryRules]) => (
          <div key={category}>
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {category}
            </h3>
            <div className="space-y-2">
              {categoryRules.map((rule, index) => (
                <div 
                  key={index} 
                  className="bg-card border border-card-border rounded-md p-3"
                  data-testid={`world-rule-${index}`}
                >
                  <p className="text-sm font-medium">{safeStringify(rule.rule)}</p>
                  {rule.constraints && rule.constraints.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {rule.constraints.map((constraint, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{safeStringify(constraint)}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function PlotDecisionsTab({ decisions }: { decisions: PlotDecision[] }) {
  if (!decisions || decisions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <GitBranch className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">Sin decisiones de trama registradas</p>
        <p className="text-muted-foreground/60 text-xs mt-1">
          El Revisor Final detectará decisiones críticas durante la revisión
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-3 pr-4">
        {decisions.map((decision, index) => (
          <Card 
            key={index} 
            className={decision.consistencia_actual === "inconsistente" ? "border-destructive/50" : ""}
            data-testid={`plot-decision-${index}`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium">{decision.decision}</CardTitle>
                <Badge 
                  variant={decision.consistencia_actual === "consistente" ? "secondary" : "destructive"}
                  className="text-xs"
                >
                  {decision.consistencia_actual === "consistente" ? "Consistente" : "Inconsistente"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs">
                  Establecido: Cap. {decision.capitulo_establecido}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Afecta: {decision.capitulos_afectados.map(c => `Cap. ${c}`).join(", ")}
                </span>
              </div>
              {decision.problema && (
                <p className="text-xs text-destructive mt-2">{decision.problema}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

function PersistentInjuriesTab({ injuries }: { injuries: PersistentInjury[] }) {
  if (!injuries || injuries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Activity className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">Sin lesiones persistentes registradas</p>
        <p className="text-muted-foreground/60 text-xs mt-1">
          El Revisor Final detectará lesiones que requieren seguimiento
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-3 pr-4">
        {injuries.map((injury, index) => (
          <Card 
            key={index} 
            className={injury.consistencia === "ignorada" ? "border-destructive/50" : ""}
            data-testid={`persistent-injury-${index}`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Skull className="h-4 w-4" />
                  {injury.personaje}
                </CardTitle>
                <Badge 
                  variant={injury.consistencia === "mantenida" ? "secondary" : "destructive"}
                  className="text-xs"
                >
                  {injury.consistencia === "mantenida" ? "Mantenida" : "Ignorada"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm">{injury.tipo_lesion}</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs">
                  Ocurre: Cap. {injury.capitulo_ocurre}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Efecto esperado:</span> {injury.efecto_esperado}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Verificado en:</span> {injury.capitulos_verificados.map(c => `Cap. ${c}`).join(", ")}
              </p>
              {injury.problema && (
                <p className="text-xs text-destructive mt-2">{injury.problema}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

function PlotTab({ plotOutline }: { plotOutline: PlotOutline | null }) {
  if (!plotOutline || !plotOutline.premise) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">Sin esquema de trama definido</p>
      </div>
    );
  }

  const { threeActStructure, chapterOutlines } = plotOutline;

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-6 pr-4">
        {plotOutline.premise && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Premisa
            </h3>
            <p className="text-sm">{safeStringify(plotOutline.premise)}</p>
          </div>
        )}

        {threeActStructure && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Estructura de Tres Actos
            </h3>
            
            {threeActStructure.act1 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Acto I: Planteamiento</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {threeActStructure.act1.setup && (
                    <div>
                      <span className="font-medium">Setup: </span>
                      {safeStringify(threeActStructure.act1.setup)}
                    </div>
                  )}
                  {threeActStructure.act1.incitingIncident && (
                    <div>
                      <span className="font-medium">Incidente Incitador: </span>
                      {safeStringify(threeActStructure.act1.incitingIncident)}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {threeActStructure.act2 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Acto II: Confrontación</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {threeActStructure.act2.risingAction && (
                    <div>
                      <span className="font-medium">Acción Ascendente: </span>
                      {safeStringify(threeActStructure.act2.risingAction)}
                    </div>
                  )}
                  {threeActStructure.act2.midpoint && (
                    <div>
                      <span className="font-medium">Punto Medio: </span>
                      {safeStringify(threeActStructure.act2.midpoint)}
                    </div>
                  )}
                  {threeActStructure.act2.complications && (
                    <div>
                      <span className="font-medium">Complicaciones: </span>
                      {safeStringify(threeActStructure.act2.complications)}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {threeActStructure.act3 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Acto III: Resolución</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {threeActStructure.act3.climax && (
                    <div>
                      <span className="font-medium">Clímax: </span>
                      {safeStringify(threeActStructure.act3.climax)}
                    </div>
                  )}
                  {threeActStructure.act3.resolution && (
                    <div>
                      <span className="font-medium">Resolución: </span>
                      {safeStringify(threeActStructure.act3.resolution)}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {chapterOutlines && chapterOutlines.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Resumen por Capítulo
            </h3>
            <div className="space-y-2">
              {chapterOutlines.map((chapter, index) => (
                <div 
                  key={index} 
                  className="bg-card border border-card-border rounded-md p-3"
                  data-testid={`chapter-outline-${chapter.number}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="text-xs">Cap. {chapter.number}</Badge>
                  </div>
                  <p className="text-sm mb-2">{safeStringify(chapter.summary)}</p>
                  <div className="flex flex-wrap gap-1">
                    {chapter.keyEvents.map((event, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{safeStringify(event)}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

export function WorldBibleDisplay({ worldBible }: WorldBibleDisplayProps) {
  if (!worldBible) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">
          No hay biblia del mundo disponible
        </p>
        <p className="text-muted-foreground/60 text-xs mt-1">
          Se generará automáticamente al crear un proyecto
        </p>
      </div>
    );
  }

  const timeline = (worldBible.timeline || []) as TimelineEvent[];
  const characters = (worldBible.characters || []) as Character[];
  const worldRules = (worldBible.worldRules || []) as WorldRule[];
  const plotOutline = (worldBible.plotOutline || null) as PlotOutline | null;
  const plotDecisions = (worldBible.plotDecisions || []) as PlotDecision[];
  const persistentInjuries = (worldBible.persistentInjuries || []) as PersistentInjury[];

  const hasDecisions = plotDecisions.length > 0;
  const hasInjuries = persistentInjuries.length > 0;

  return (
    <Tabs defaultValue="plot" className="w-full" data-testid="world-bible-tabs">
      <TabsList className="w-full justify-start mb-4 flex-wrap gap-1">
        <TabsTrigger value="plot" className="gap-1.5">
          <BookOpen className="h-4 w-4" />
          Trama
        </TabsTrigger>
        <TabsTrigger value="timeline" className="gap-1.5">
          <Clock className="h-4 w-4" />
          Cronología
        </TabsTrigger>
        <TabsTrigger value="characters" className="gap-1.5">
          <Users className="h-4 w-4" />
          Personajes
        </TabsTrigger>
        <TabsTrigger value="rules" className="gap-1.5">
          <Shield className="h-4 w-4" />
          Reglas
        </TabsTrigger>
        <TabsTrigger value="decisions" className="gap-1.5">
          <GitBranch className="h-4 w-4" />
          Decisiones
          {hasDecisions && (
            <Badge variant="secondary" className="ml-1 text-xs">{plotDecisions.length}</Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="injuries" className="gap-1.5">
          <Activity className="h-4 w-4" />
          Lesiones
          {hasInjuries && (
            <Badge variant="secondary" className="ml-1 text-xs">{persistentInjuries.length}</Badge>
          )}
        </TabsTrigger>
      </TabsList>
      
      <TabsContent value="plot">
        <PlotTab plotOutline={plotOutline} />
      </TabsContent>
      
      <TabsContent value="timeline">
        <TimelineTab events={timeline} />
      </TabsContent>
      
      <TabsContent value="characters">
        <CharactersTab characters={characters} />
      </TabsContent>
      
      <TabsContent value="rules">
        <WorldRulesTab rules={worldRules} />
      </TabsContent>

      <TabsContent value="decisions">
        <PlotDecisionsTab decisions={plotDecisions} />
      </TabsContent>

      <TabsContent value="injuries">
        <PersistentInjuriesTab injuries={persistentInjuries} />
      </TabsContent>
    </Tabs>
  );
}
