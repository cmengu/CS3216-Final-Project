import type { Project } from "./projects";

/** Keep IDs for duplicate names and compatibility with existing invoice links. */
export function findGroup(projects: Project[], params: Pick<URLSearchParams, "get">) {
  const name = params.get("group");
  const id = params.get("project");
  if (name !== null) {
    return projects.find(p => p.name === name && p.id === id)
      ?? projects.find(p => p.name === name);
  }
  return projects.find(p => p.id === id);
}

export function groupUrl(path: string, project: Project) {
  return `${path}?${new URLSearchParams({ group: project.name, project: project.id })}`;
}
