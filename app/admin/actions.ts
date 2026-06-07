/**
 * Server action backing the /admin code gate. Validates the submitted code
 * against ADMIN_CODE and, on success, sets an httpOnly cookie so the dashboard
 * renders on subsequent requests. The code never reaches client JS.
 */
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const ADMIN_CODE = process.env.ADMIN_CODE ?? "";

export async function login(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "").trim();
  if (ADMIN_CODE && code === ADMIN_CODE) {
    const store = await cookies();
    // Cookie name must stay in sync with app/admin/page.tsx ("use server"
    // modules can only export async functions, so this can't be shared).
    store.set("admin_auth", code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/admin",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    redirect("/admin");
  }
  redirect("/admin?error=1");
}
