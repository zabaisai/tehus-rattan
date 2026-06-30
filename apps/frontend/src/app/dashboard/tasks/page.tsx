'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, Trash2 } from 'lucide-react';
import { getTasks, createTask, completeTask, deleteTask } from '@/lib/tasks';
import { Task } from '@/types';
import { TaskModal } from '@/components/tasks/TaskModal';

const priorityColors: Record<string, string> = {
  LOW: 'bg-stone-100 text-stone-600',
  MEDIUM: 'bg-blue-50 text-blue-700',
  HIGH: 'bg-orange-50 text-orange-700',
  URGENT: 'bg-red-50 text-red-700',
};

const priorityLabels: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

function groupTasks(tasks: Task[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 86400000);
  const endOfWeek = new Date(startOfToday.getTime() + 7 * 86400000);

  const groups = {
    overdue: [] as Task[],
    today: [] as Task[],
    thisWeek: [] as Task[],
    later: [] as Task[],
    noDate: [] as Task[],
  };

  for (const task of tasks) {
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') continue;
    if (!task.dueDate) {
      groups.noDate.push(task);
      continue;
    }
    const due = new Date(task.dueDate);
    if (due < startOfToday) groups.overdue.push(task);
    else if (due < endOfToday) groups.today.push(task);
    else if (due < endOfWeek) groups.thisWeek.push(task);
    else groups.later.push(task);
  }

  return groups;
}

function TaskRow({
  task,
  onComplete,
  onDelete,
}: {
  task: Task;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2.5 last:border-0">
      <div className="flex items-center gap-3">
        <button
          onClick={() => onComplete(task.id)}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-stone-300 text-transparent hover:border-stone-500 hover:text-stone-500"
        >
          <Check size={12} />
        </button>
        <div>
          <p className="text-sm text-stone-800">{task.title}</p>
          {(task.lead || task.contact) && (
            <p className="text-xs text-stone-400">
              {task.lead?.title || task.contact?.name}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityColors[task.priority]}`}>
          {priorityLabels[task.priority]}
        </span>
        <button
          onClick={() => onDelete(task.id)}
          className="rounded p-1 text-stone-300 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  onComplete,
  onDelete,
  accent,
}: {
  title: string;
  tasks: Task[];
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  accent?: string;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className="mb-4">
      <h3 className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${accent ?? 'text-stone-500'}`}>
        {title} ({tasks.length})
      </h3>
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} onComplete={onComplete} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const queryClient = useQueryClient();
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: getTasks,
  });

  const [modalOpen, setModalOpen] = useState(false);

  const groups = useMemo(() => groupTasks(tasks ?? []), [tasks]);

  async function handleCreate(data: {
    title: string;
    description: string;
    dueDate: string;
    priority: string;
    type: string;
  }) {
    await createTask({
      title: data.title,
      description: data.description || undefined,
      dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : undefined,
      priority: data.priority,
      type: data.type,
    });
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    setModalOpen(false);
  }

  async function handleComplete(id: string) {
    await completeTask(id);
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta tarea?')) return;
    await deleteTask(id);
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-stone-900">Tareas</h2>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800"
        >
          <Plus size={16} />
          Nueva tarea
        </button>
      </div>

      {isLoading && <p className="text-sm text-stone-400">Cargando...</p>}

      {!isLoading && (tasks?.length ?? 0) === 0 && (
        <p className="text-sm text-stone-400">No hay tareas.</p>
      )}

      <TaskGroup title="Vencidas" tasks={groups.overdue} onComplete={handleComplete} onDelete={handleDelete} accent="text-red-600" />
      <TaskGroup title="Hoy" tasks={groups.today} onComplete={handleComplete} onDelete={handleDelete} />
      <TaskGroup title="Esta semana" tasks={groups.thisWeek} onComplete={handleComplete} onDelete={handleDelete} />
      <TaskGroup title="Más adelante" tasks={groups.later} onComplete={handleComplete} onDelete={handleDelete} />
      <TaskGroup title="Sin fecha" tasks={groups.noDate} onComplete={handleComplete} onDelete={handleDelete} />

      {modalOpen && <TaskModal onClose={() => setModalOpen(false)} onSubmit={handleCreate} />}
    </div>
  );
}