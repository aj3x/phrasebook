import { useQuery } from '@tanstack/react-query';
import { type FetchImpl, fetchAccessibleProjects } from './api';

export interface ProjectPickerProps {
  endpoint: string;
  onSignOut: () => void;
  onSelectProject: (project: string) => void;
  fetchImpl?: FetchImpl;
}

export function ProjectPicker({
  endpoint,
  onSignOut,
  onSelectProject,
  fetchImpl,
}: ProjectPickerProps) {
  const { data, isPending, error } = useQuery({
    queryKey: ['accessible-projects', endpoint],
    queryFn: () => fetchAccessibleProjects(endpoint, fetchImpl),
  });

  return (
    <main>
      <h1>Projects</h1>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>

      {isPending && <p>Loading projects…</p>}
      {error && <p role="alert">Failed to load projects.</p>}
      {data && data.length === 0 && <p>No projects available. Ask an admin to grant you access.</p>}
      {data && data.length > 0 && (
        <ul>
          {data.map((project) => (
            <li key={project.name}>
              <button type="button" onClick={() => onSelectProject(project.name)}>
                {project.name} (source: {project.sourceLocale})
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
