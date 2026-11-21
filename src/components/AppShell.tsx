"use client";

import React, { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  FileCheck2,
  Lock,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { useTheme } from "./ThemeProvider";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Live Workbench",
    sub: "Bill + Voice Triage",
    icon: FileCheck2,
  },
  {
    href: "/governance",
    label: "Governance Ledger",
    sub: "ISO 42001 & Bias",
    icon: ShieldCheck,
  },
  {
    href: "/benchmarks",
    label: "Benchmarks & Speed",
    sub: "500 Bills + Red-Team",
    icon: BarChart3,
  },
  {
    href: "/privacy",
    label: "DPDP Privacy Vault",
    sub: "PII Scrub & Rights",
    icon: Lock,
  },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  const openMobileNav = () => {
    dialogRef.current?.showModal();
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col lg:flex-row">
      {/* Desktop Compact Left Rail (fits comfortably inside 1440x900 without clipping) */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:justify-between bg-rail border-r border-line sticky top-0 h-screen">
        <div className="p-4 overflow-y-auto app-rail-scroll">
          <Link href="/" className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-lg hover:bg-rail-hover">
            <Image
              src="/images/khatacheck-logo.png"
              alt="KhataCheck emblem"
              width={32}
              height={32}
              loading="eager"
              unoptimized
              className="w-8 h-8 rounded-md object-contain bg-white border border-line"
            />
            <div className="min-w-0">
              <div className="type-section leading-tight text-ink">KhataCheck</div>
              <div className="type-meta text-faint truncate">Stage 4 Governance PoC</div>
            </div>
          </Link>

          <div className="mt-4 mb-1.5 px-2.5 type-meta uppercase tracking-wider text-faint">
            Operations
          </div>
          <nav aria-label="Primary navigation" className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 min-h-[30px] px-2.5 py-2 rounded-lg border transition-colors ${
                    active
                      ? "bg-surface border-line-strong text-ink shadow-xs"
                      : "border-transparent text-muted hover:bg-rail-hover hover:text-ink"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="type-table-cell font-medium truncate">{item.label}</div>
                    <div className="type-meta text-faint truncate">{item.sub}</div>
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="mt-5 p-3 rounded-lg bg-subtle border border-line">
            <div className="type-kpi-label text-ink">Synthetic Demo Mode</div>
            <p className="type-meta text-muted mt-1 leading-relaxed">
              Isolated integer-paise GST checks. Models extract bills and speech, never compute totals.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="type-pill px-2 py-0.5 rounded pill-cobalt">ISO/IEC 42001</span>
              <span className="type-pill px-2 py-0.5 rounded pill-success">DPDP 2023</span>
            </div>
          </div>
        </div>

        {/* Compact ~76px footer */}
        <div className="p-3 border-t border-line flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="type-kpi-label text-ink truncate">Ganesh Kirana Store</div>
            <div className="type-meta text-faint truncate">BLR · Synthetic Tenant</div>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-surface border border-line-strong text-ink hover:bg-subtle cursor-pointer shrink-0"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-surface border-b border-line sticky top-0 z-30">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/images/khatacheck-logo.png"
            alt="KhataCheck emblem"
            width={28}
            height={28}
            loading="eager"
            unoptimized
            className="w-7 h-7 rounded-md object-contain bg-white border border-line"
          />
          <span className="type-section text-ink">KhataCheck</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-subtle border border-line text-ink"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={openMobileNav}
            aria-label="Open navigation menu"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-subtle border border-line text-ink"
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>
      </header>

      <dialog
        ref={dialogRef}
        className="lg:hidden m-0 p-0 w-72 max-w-[85vw] h-full max-h-full bg-surface text-ink border-r border-line backdrop:bg-black/50"
      >
        <div className="p-4 flex flex-col h-full justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="type-section text-ink">KhataCheck Menu</span>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                aria-label="Close navigation menu"
                className="p-1.5 rounded-lg bg-subtle border border-line text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="space-y-1.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border ${
                      active ? "bg-subtle border-line-strong text-ink" : "border-transparent text-muted"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="type-body font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="type-meta text-faint border-t border-line pt-3">
            NeuraViz AI Challenge 2026-27 · Stage 4
          </div>
        </div>
      </dialog>

      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-7 max-w-[1440px]">{children}</main>
    </div>
  );
}
