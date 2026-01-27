import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock, Loader2, BookOpen } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password.trim()) {
      toast({
        title: "Error",
        description: "Por favor, introduce la contraseña",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const response = await apiRequest("POST", "/api/auth/login", { password });

      const data = await response.json();
      if (data.success) {
        toast({
          title: "Acceso concedido",
          description: "Bienvenido a LitAgents",
        });
        onLoginSuccess();
      }
    } catch (error: any) {
      toast({
        title: "Acceso denegado",
        description: "Contraseña incorrecta",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center mb-2">
            <div className="p-3 bg-primary/10 rounded-full">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">LitAgents</CardTitle>
          <CardDescription>
            Sistema de Orquestación de Agentes Literarios
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña de acceso</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Introduce la contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  autoFocus
                  data-testid="input-password"
                />
              </div>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
              data-testid="button-login"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verificando...
                </>
              ) : (
                "Acceder"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
