"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/workspace", label: "Workspace" },
  { href: "/knowledge-base", label: "Knowledge Base" },
  { href: "/analytics", label: "Analytics" },
  { href: "/about", label: "About" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="relative z-20 flex items-center justify-between px-6 py-6 md:px-12">
      <Link href="/" className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Satellite className="h-4 w-4 text-white" strokeWidth={2.4} />
        </div>
        <span className="font-display text-base font-bold tracking-tight">MissionDoc AI</span>
      </Link>
      <div className="hidden items-center gap-8 text-sm text-muted md:flex">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "transition-colors hover:text-foreground",
              pathname === link.href && "text-foreground"
            )}
          >
            {link.label}
          </Link>
        ))}
      </div>
      <Link href="/settings">
        <Button variant="outline" size="sm">Settings</Button>
      </Link>
    </nav>
  );
}
