import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Zap, GraduationCap, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { useLogin } from "@/api-client";
import { setStoredUser, getStoredUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Login() {
  const [, setLocation] = useLocation();
  const [collegeId, setCollegeId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const loginMutation = useLogin();

  useEffect(() => {
    const user = getStoredUser();
    if (user) {
      if ((user.role === "student" || user.role === "super_student") && user.onboardingRequired) {
        setLocation("/first-login-setup");
        return;
      }
      setLocation(user.role === "admin" ? "/admin" : "/home");
    }
  }, [setLocation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!collegeId.trim() || !password.trim()) return;

    loginMutation.mutate(
      { data: { collegeId, password } },
      {
        onSuccess: (data) => {
          setStoredUser(data);
          if ((data.role === "student" || data.role === "super_student") && data.onboardingRequired) {
            setLocation("/first-login-setup");
            return;
          }
          setLocation(data.role === "admin" ? "/admin" : "/home");
        }
      }
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-[0.15] mix-blend-multiply pointer-events-none">
        <img 
          src={`${import.meta.env.BASE_URL}images/academic-bg.png`} 
          alt="" 
          className="w-full h-full object-cover"
        />
      </div>

      <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px]" />
      <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-blue-400/5 blur-[120px]" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md px-4 relative z-10"
      >
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 sm:p-10 border border-white shadow-[0_8px_40px_rgb(0,0,0,0.06)]">
          <div className="flex justify-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-white shadow-xl shadow-primary/25">
              <Zap className="w-8 h-8" />
            </div>
          </div>
          
          <div className="text-center mb-8">
            <h1 className="text-3xl font-display font-bold text-foreground">
              Welcome to <span className="text-primary">PrepMap</span>
            </h1>
            <p className="mt-2 text-muted-foreground text-sm">Sign in with your credentials to access your exam roadmap.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-primary" />
                ID
              </label>
              <Input
                placeholder="e.g. STU001"
                value={collegeId}
                onChange={(e) => setCollegeId(e.target.value)}
                autoFocus
                className="bg-white/50 focus:bg-white"
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary" />
                Password
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setIsCapsLockOn(e.getModifierState("CapsLock"))}
                  onKeyDown={(e) => setIsCapsLockOn(e.getModifierState("CapsLock"))}
                  onBlur={() => setIsCapsLockOn(false)}
                  className="bg-white/50 pr-11 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {isCapsLockOn && (
                <p className="text-xs font-medium text-amber-700">
                  Caps Lock is ON
                </p>
              )}
            </div>

            <Button 
              type="submit" 
              className="w-full h-14 text-base mt-4 group"
              disabled={loginMutation.isPending || !collegeId.trim() || !password.trim()}
            >
              {loginMutation.isPending ? "Authenticating..." : "Sign In"}
              {!loginMutation.isPending && (
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              )}
            </Button>

            {loginMutation.isError && (
              <p className="text-sm text-destructive text-center font-medium p-3 bg-destructive/10 rounded-xl">
                Invalid credentials. Please check your ID and password.
              </p>
            )}
          </form>

          <div className="mt-6 text-center">
            <Link href="/reset-password" className="text-sm text-primary hover:underline">
              Reset your password
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}


