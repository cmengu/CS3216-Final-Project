"use client";

import { NotFound } from "@/components/shell/Guard";

/** notFound() inside the shell (an unknown Settings pane): the same Not found as a page this role may not open. */
export default function ShellNotFound() {
  return <NotFound />;
}
