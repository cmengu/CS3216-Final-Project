import { SERVICE_URL } from "@/checker/api";

export type ContactForm = { name: string; email: string; company: string; message: string; website: string };

/** Plain sentences for each way sending can fail. */
export function contactFailure(status: number, retryAfter?: string | null): string {
  if (status === 422) return "Check your name, a valid email, and a message of at least 10 characters.";
  if (status === 429) {
    const minutes = Math.max(1, Math.ceil(Number(retryAfter ?? 0) / 60) || 1);
    return `Too many messages from here. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  if (status === 503) return "We couldn't send your message right now. Please try again later.";
  return "Something went wrong sending your message. Please try again.";
}

/** Send the landing page contact form; the service emails it to the team. Throws a plain sentence. */
export async function sendContact(form: ContactForm, signal?: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${SERVICE_URL}/contact`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Requested-With": "InvoiceChecker" },
      body: JSON.stringify(form),
      signal,
    });
  } catch {
    throw new Error("We couldn't reach our server. Check your connection and try again.");
  }
  if (!response.ok) throw new Error(contactFailure(response.status, response.headers.get("Retry-After")));
}
