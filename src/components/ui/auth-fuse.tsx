"use client";

import * as React from "react";
import { useState, useId, useEffect } from "react";
import { Slot } from "@radix-ui/react-slot";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TypewriterProps {
    text: string | string[];
    speed?: number;
    cursor?: string;
    loop?: boolean;
    deleteSpeed?: number;
    delay?: number;
    className?: string;
}

export function Typewriter({
    text,
    speed = 100,
    cursor = "|",
    loop = false,
    deleteSpeed = 50,
    delay = 1500,
    className,
}: TypewriterProps) {
    const [displayText, setDisplayText] = useState("");
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isDeleting, setIsDeleting] = useState(false);
    const [textArrayIndex, setTextArrayIndex] = useState(0);

    const textArray = Array.isArray(text) ? text : [text];
    const currentText = textArray[textArrayIndex] || "";

    useEffect(() => {
        if (!currentText) return;

        const timeout = setTimeout(
            () => {
                if (!isDeleting) {
                    if (currentIndex < currentText.length) {
                        setDisplayText((prev) => prev + currentText[currentIndex]);
                        setCurrentIndex((prev) => prev + 1);
                    } else if (loop) {
                        setTimeout(() => setIsDeleting(true), delay);
                    }
                } else {
                    if (displayText.length > 0) {
                        setDisplayText((prev) => prev.slice(0, -1));
                    } else {
                        setIsDeleting(false);
                        setCurrentIndex(0);
                        setTextArrayIndex((prev) => (prev + 1) % textArray.length);
                    }
                }
            },
            isDeleting ? deleteSpeed : speed,
        );

        return () => clearTimeout(timeout);
    }, [
        currentIndex,
        isDeleting,
        currentText,
        loop,
        speed,
        deleteSpeed,
        delay,
        displayText,
        textArray.length,
    ]);

    return (
        <span className={className}>
            {displayText}
            <span className="animate-pulse">{cursor}</span>
        </span>
    );
}

const labelVariants = cva(
    "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
);

const Label = React.forwardRef<
    React.ElementRef<typeof LabelPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
    <LabelPrimitive.Root
        ref={ref}
        className={cn(labelVariants(), className)}
        {...props}
    />
));
Label.displayName = LabelPrimitive.Root.displayName;

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground hover:bg-primary/90",
                destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                outline: "border border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30 text-white",
                secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                ghost: "hover:bg-white/10 hover:text-white",
                link: "text-white/60 underline-offset-4 hover:underline",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "h-9 rounded-md px-3",
                lg: "h-12 rounded-md px-6",
                icon: "h-8 w-8",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button";
        return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
    }
);
Button.displayName = "Button";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
    ({ className, type, ...props }, ref) => {
        return (
            <input
                type={type}
                className={cn(
                    "flex h-10 w-full rounded-lg border border-white/20 bg-white/5 px-3 py-3 text-sm text-white shadow-sm shadow-black/5 transition-all placeholder:text-white/40 focus:bg-white/10 focus:border-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-50",
                    className
                )}
                ref={ref}
                {...props}
            />
        );
    }
);
Input.displayName = "Input";

export interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
    ({ className, label, ...props }, ref) => {
        const id = useId();
        const [showPassword, setShowPassword] = useState(false);
        const togglePasswordVisibility = () => setShowPassword((prev) => !prev);
        return (
            <div className="grid w-full items-center gap-2">
                {label && <Label htmlFor={id} className="text-white/80">{label}</Label>}
                <div className="relative">
                    <Input
                        id={id}
                        type={showPassword ? "text" : "password"}
                        className={cn("pe-10", className)}
                        ref={ref}
                        {...props}
                    />
                    <button
                        type="button"
                        onClick={togglePasswordVisibility}
                        className="absolute inset-y-0 end-0 flex h-full w-10 items-center justify-center text-white/50 transition-colors hover:text-white focus-visible:text-white focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                        {showPassword ? (
                            <EyeOff className="size-4" aria-hidden="true" />
                        ) : (
                            <Eye className="size-4" aria-hidden="true" />
                        )}
                    </button>
                </div>
            </div>
        );
    }
);
PasswordInput.displayName = "PasswordInput";

interface SignInFormProps {
    onSubmit: (email: string, password: string) => Promise<void>;
    onGoogleSignIn: () => Promise<void>;
    isLoading: boolean;
    error: string | null;
}

function SignInForm({ onSubmit, onGoogleSignIn, isLoading, error }: SignInFormProps) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        await onSubmit(email, password);
    };

    return (
        <form onSubmit={handleSignIn} autoComplete="on" className="flex flex-col gap-6">
            <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold text-white">Welcome Back</h1>
                <p className="text-balance text-sm text-white/60">Sign in to sync your downloads across devices</p>
            </div>

            {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center">
                    {error}
                </div>
            )}

            <div className="grid gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="email" className="text-white/80">Email</Label>
                    <Input
                        id="email"
                        name="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@example.com"
                        required
                        autoComplete="email"
                        disabled={isLoading}
                    />
                </div>
                <PasswordInput
                    name="password"
                    label="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    disabled={isLoading}
                />
                <Button type="submit" variant="outline" className="mt-2 h-11" disabled={isLoading}>
                    {isLoading ? <Loader2 className="animate-spin" /> : "Sign In"}
                </Button>
            </div>

            <div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-white/20">
                <span className="relative z-10 bg-neutral-950 px-2 text-white/50">Or continue with</span>
            </div>

            <Button variant="outline" type="button" className="h-11" onClick={onGoogleSignIn} disabled={isLoading}>
                {isLoading ? (
                    <Loader2 className="animate-spin" />
                ) : (
                    <>
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                        Continue with Google
                    </>
                )}
            </Button>
        </form>
    );
}

interface SignUpFormProps {
    onSubmit: (email: string, password: string, displayName: string) => Promise<void>;
    onGoogleSignIn: () => Promise<void>;
    isLoading: boolean;
    error: string | null;
}

function SignUpForm({ onSubmit, onGoogleSignIn, isLoading, error }: SignUpFormProps) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [displayName, setDisplayName] = useState("");

    const handleSignUp = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        await onSubmit(email, password, displayName);
    };

    return (
        <form onSubmit={handleSignUp} autoComplete="on" className="flex flex-col gap-6">
            <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold text-white">Create Account</h1>
                <p className="text-balance text-sm text-white/60">Join to sync downloads across all your devices</p>
            </div>

            {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center">
                    {error}
                </div>
            )}

            <div className="grid gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="name" className="text-white/80">Display Name</Label>
                    <Input
                        id="name"
                        name="name"
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="John Doe"
                        required
                        autoComplete="name"
                        disabled={isLoading}
                    />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="signup-email" className="text-white/80">Email</Label>
                    <Input
                        id="signup-email"
                        name="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@example.com"
                        required
                        autoComplete="email"
                        disabled={isLoading}
                    />
                </div>
                <PasswordInput
                    name="password"
                    label="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="Create a password (min 6 chars)"
                    disabled={isLoading}
                />
                <Button type="submit" variant="outline" className="mt-2 h-11" disabled={isLoading}>
                    {isLoading ? <Loader2 className="animate-spin" /> : "Create Account"}
                </Button>
            </div>

            <div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-white/20">
                <span className="relative z-10 bg-neutral-950 px-2 text-white/50">Or continue with</span>
            </div>

            <Button variant="outline" type="button" className="h-11" onClick={onGoogleSignIn} disabled={isLoading}>
                {isLoading ? (
                    <Loader2 className="animate-spin" />
                ) : (
                    <>
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                        Continue with Google
                    </>
                )}
            </Button>
        </form>
    );
}

interface AuthFormContainerProps {
    isSignIn: boolean;
    onToggle: () => void;
    onSignIn: (email: string, password: string) => Promise<void>;
    onSignUp: (email: string, password: string, displayName: string) => Promise<void>;
    onGoogleSignIn: () => Promise<void>;
    onSkip?: () => void;
    isLoading: boolean;
    error: string | null;
}

function AuthFormContainer({
    isSignIn,
    onToggle,
    onSignIn,
    onSignUp,
    onGoogleSignIn,
    onSkip,
    isLoading,
    error
}: AuthFormContainerProps) {
    return (
        <div className="mx-auto grid w-[380px] gap-4">
            {isSignIn ? (
                <SignInForm onSubmit={onSignIn} onGoogleSignIn={onGoogleSignIn} isLoading={isLoading} error={error} />
            ) : (
                <SignUpForm onSubmit={onSignUp} onGoogleSignIn={onGoogleSignIn} isLoading={isLoading} error={error} />
            )}

            <div className="text-center text-sm text-white/60">
                {isSignIn ? "Don't have an account?" : "Already have an account?"}{" "}
                <Button variant="link" className="pl-1 text-white/70 hover:text-white" onClick={onToggle} disabled={isLoading}>
                    {isSignIn ? "Sign up" : "Sign in"}
                </Button>
            </div>

            {onSkip && (
                <button
                    onClick={onSkip}
                    disabled={isLoading}
                    className="text-sm text-white/40 hover:text-white/60 transition-colors disabled:opacity-50"
                >
                    Continue without an account →
                </button>
            )}
        </div>
    );
}

interface AuthContentProps {
    image?: {
        src: string;
        alt: string;
    };
    quote?: {
        text: string;
        author: string;
    };
}

interface AuthUIProps {
    signInContent?: AuthContentProps;
    signUpContent?: AuthContentProps;
    onSignIn: (email: string, password: string) => Promise<void>;
    onSignUp: (email: string, password: string, displayName: string) => Promise<void>;
    onGoogleSignIn: () => Promise<void>;
    onSkip?: () => void;
    isLoading: boolean;
    error: string | null;
}

const defaultSignInContent = {
    image: {
        src: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&q=80",
        alt: "Abstract gradient background"
    },
    quote: {
        text: "Welcome back! Your downloads await.",
        author: "Slasshy OmniDownloader"
    }
};

const defaultSignUpContent = {
    image: {
        src: "https://images.unsplash.com/photo-1557683316-973673baf926?w=1200&q=80",
        alt: "Colorful abstract waves"
    },
    quote: {
        text: "Join us and download from 1000+ platforms.",
        author: "Slasshy OmniDownloader"
    }
};

export function AuthUI({
    signInContent = {},
    signUpContent = {},
    onSignIn,
    onSignUp,
    onGoogleSignIn,
    onSkip,
    isLoading,
    error
}: AuthUIProps) {
    const [isSignIn, setIsSignIn] = useState(true);
    const toggleForm = () => {
        setIsSignIn((prev) => !prev);
    };

    const finalSignInContent = {
        image: { ...defaultSignInContent.image, ...signInContent.image },
        quote: { ...defaultSignInContent.quote, ...signInContent.quote },
    };
    const finalSignUpContent = {
        image: { ...defaultSignUpContent.image, ...signUpContent.image },
        quote: { ...defaultSignUpContent.quote, ...signUpContent.quote },
    };

    const currentContent = isSignIn ? finalSignInContent : finalSignUpContent;

    return (
        <div className="w-full min-h-screen md:grid md:grid-cols-2 bg-black">
            <style>{`
        input[type="password"]::-ms-reveal,
        input[type="password"]::-ms-clear {
          display: none;
        }
      `}</style>

            {/* Form Panel */}
            <div className="flex h-screen items-center justify-center p-6 md:h-auto md:p-0 md:py-12 bg-gradient-to-br from-black via-neutral-950 to-neutral-900">
                <AuthFormContainer
                    isSignIn={isSignIn}
                    onToggle={toggleForm}
                    onSignIn={onSignIn}
                    onSignUp={onSignUp}
                    onGoogleSignIn={onGoogleSignIn}
                    onSkip={onSkip}
                    isLoading={isLoading}
                    error={error}
                />
            </div>

            {/* Image Panel */}
            <div
                className="hidden md:block relative bg-cover bg-center transition-all duration-700 ease-in-out"
                style={{ backgroundImage: `url(${currentContent.image.src})` }}
                key={currentContent.image.src}
            >
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/30 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-slate-900/50 to-transparent" />

                {/* Quote */}
                <div className="relative z-10 flex h-full flex-col items-center justify-end p-8 pb-12">
                    <blockquote className="space-y-3 text-center text-white max-w-md">
                        <p className="text-xl font-medium leading-relaxed">
                            "<Typewriter
                                key={currentContent.quote.text}
                                text={currentContent.quote.text}
                                speed={50}
                            />"
                        </p>
                        <cite className="block text-sm font-light text-white/60 not-italic">
                            — {currentContent.quote.author}
                        </cite>
                    </blockquote>
                </div>
            </div>
        </div>
    );
}

export { Button, Input, Label, PasswordInput };
