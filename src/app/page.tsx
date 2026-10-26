"use client";

/* Sends each person where they belong: sign in, the master list on first run, else Invoices. */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useUser } from "@/auth";
import { useMasterList, useMasterListError, refreshMasterList } from "@/masterList";

export default function Root() {
  const user = useUser();
  const ml = useMasterList();
  const error = useMasterListError();
  const router = useRouter();
  useEffect(() => {
    if (user === undefined) return;
    if (user === null) {
      router.replace("/sign-in");
      return;
    }
    if (ml === undefined) return;
    router.replace(!ml ? "/master-list" : "/invoices");
  }, [user, ml, router]);
  if (!user) return null;
  if (error) return <div className="ic-page"><p role="alert">{error}</p><button className="ic-btn" onClick={() => void refreshMasterList()}>Retry</button></div>;
  return null;
}
