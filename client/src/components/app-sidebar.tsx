import { Link, useLocation } from "wouter";
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
  LayoutDashboard, 
  BookOpen, 
  Brain, 
  Globe, 
  Settings,
  Feather,
  User,
  Upload
} from "lucide-react";

const mainNavItems = [
  { title: "Panel Principal", url: "/", icon: LayoutDashboard },
  { title: "Manuscrito", url: "/manuscript", icon: BookOpen },
  { title: "Biblia del Mundo", url: "/world-bible", icon: Globe },
  { title: "Logs de Pensamiento", url: "/thought-logs", icon: Brain },
];

const translationsNavItems = [
  { title: "Traducciones", url: "/translations", icon: Upload },
];

const settingsNavItems = [
  { title: "Pseudónimos", url: "/pseudonyms", icon: User },
  { title: "Configuración", url: "/config", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();

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
          <SidebarGroupLabel>Traducciones</SidebarGroupLabel>
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

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <p className="text-xs text-muted-foreground text-center">
          Powered by Gemini 3 Pro
        </p>
        <p className="text-xs text-muted-foreground/60 text-center">
          Deep Thinking Engine
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
