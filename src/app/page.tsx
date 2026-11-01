"use client";

/* Sends each person where they belong: sign in, the master list on first run, else Invoices. */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useUser } from "@/auth";


export default function Root() {
  const user = useUser();
  const router = useRouter();
  useEffect(() => {
    if (user === undefined) return;
    if (user === null) {
      router.replace("/sign-in");
      return;
    }
    router.replace("/invoices");
  }, [user, router]);
  if (!user) return null;
  return null;
}