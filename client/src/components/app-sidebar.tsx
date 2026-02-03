import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  LayoutDashboard, 
  BookOpen, 
  Brain, 
  Globe, 
  Settings,
  Feather,
  User,
  Upload,
  Download,
  Library,
  ListOrdered,
  Edit3,
  Zap,
  Sparkles,
  DollarSign,
  GitCompare,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const mainNavItems = [
  { title: "Panel Principal", url: "/", icon: LayoutDashboard },
  { title: "Generar Guía", url: "/generate-guide", icon: Sparkles },
  { title: "Generar Serie", url: "/generate-series-guide", icon: Library },
  { title: "Manuscrito", url: "/manuscript", icon: BookOpen },
  { title: "Biblia del Mundo", url: "/world-bible", icon: Globe },
  { title: "Logs de Pensamiento", url: "/thought-logs", icon: Brain },
];

const translationsNavItems = [
  { title: "Importar Libros", url: "/translations", icon: Upload },
  { title: "Exportar y Traducir", url: "/export", icon: Download },
  { title: "Comparar Versiones", url: "/compare", icon: GitCompare },
  { title: "Reeditar Manuscrito", url: "/reedit", icon: Edit3 },
];

const settingsNavItems = [
  { title: "Pseudónimos", url: "/pseudonyms", icon: User },
  { title: "Series", url: "/series", icon: Library },
  { title: "Cola de Proyectos", url: "/queue", icon: ListOrdered },
  { title: "Historial de Costos", url: "/costs-history", icon: DollarSign },
  { title: "Configuración", url: "/config", icon: Settings },
];

interface AIProviderInfo {
  current: "gemini" | "deepseek";
  available: { gemini: boolean; deepseek: boolean };
}

export function AppSidebar() {
  const [location] = useLocation();
  const { toast } = useToast();
  
  const { data: providerInfo } = useQuery<AIProviderInfo>({
    queryKey: ["/api/ai-provider"],
  });
  
  const switchProviderMutation = useMutation({
    mutationFn: async (provider: "gemini" | "deepseek") => {
      return apiRequest("/api/ai-provider", "POST", { provider });
    },
    onSuccess: (_, selectedProvider) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-provider"] });
      toast({
        title: "Motor de IA actualizado",
        description: `Ahora usando ${selectedProvider === "gemini" ? "Gemini (rápido)" : "DeepSeek (económico)"}`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo cambiar el motor de IA",
        variant: "destructive",
      });
    },
  });

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <Link href="/" className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary text-primary-foreground">
            <Feather className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-semibold text-lg">LitAgents</h1>
            <p className="text-xs text-muted-foreground">Orquestador Literario</p>
          </div>
        </Link>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.url.replace("/", "") || "dashboard"}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Manuscritos</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {translationsNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.url.replace("/", "")}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.url.replace("/", "")}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4 space-y-3">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Motor de IA</label>
          <Select
            value={providerInfo?.current || "deepseek"}
            onValueChange={(value: "gemini" | "deepseek") => {
              switchProviderMutation.mutate(value);
            }}
            disabled={switchProviderMutation.isPending}
          >
            <SelectTrigger 
              className="w-full h-8 text-xs"
              data-testid="select-ai-provider"
            >
              <SelectValue placeholder="Seleccionar motor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem 
                value="gemini" 
                disabled={!providerInfo?.available?.gemini}
              >
                <div className="flex items-center gap-2">
                  <Zap className="h-3 w-3 text-amber-500" />
                  <span>Gemini (Rápido)</span>
                </div>
              </SelectItem>
              <SelectItem 
                value="deepseek"
                disabled={!providerInfo?.available?.deepseek}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-blue-500" />
                  <span>DeepSeek (Económico)</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground/60 text-center">
          {providerInfo?.current === "gemini" ? "Gemini 3 Pro - Rápido" : "DeepSeek V3/R1 - Económico"}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
