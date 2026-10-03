import type { Person, Role } from "./types";

export const ROLES: Record<Role, string> = {
  owner: "Owner",
  coordinator: "Sales coordinator",
  account_manager: "Account manager",
  packing: "Packing lead",
  finance: "Finance admin",
};

/* The five invented people. */
export const PEOPLE: Person[] = [
  { id: "u1", name: "May", role: "owner", email: "may@ediblegardencity.example", customers: "all" },
  { id: "u2", name: "Eunice", role: "coordinator", email: "eunice@ediblegardencity.example", customers: "all" },
  { id: "u3", name: "Dennis", role: "account_manager", email: "dennis@ediblegardencity.example", customers: ["C10243", "C10310"] },
  { id: "u4", name: "Mei", role: "packing", email: "mei@ediblegardencity.example", customers: "all" },
  { id: "u5", name: "Farah", role: "finance", email: "farah@ediblegardencity.example", customers: "all" },
];
