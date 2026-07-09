'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, Trash2, Pencil } from 'lucide-react';
import { getTasks, createTask, updateTask, completeTask, deleteTask } from '@/lib/tasks';
import { Task } from '@/types';
import { TaskModal, TaskFormData } from '@/components/tasks/TaskModal';

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

const statusLabels: Record<string, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En progreso',
};

function formatDueDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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
  onEdit,
}: {
  task: Task;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: Task) => void;
}) {
  const dueLabel = formatDueDate(task.dueDate);
  const relationParts = [
    task.lead && `Lead: ${task.lead.title}`,
    task.contact && `Contacto: ${task.contact.name || 'sin nombre'}`,
    task.agent && `Responsable: ${task.agent.name}`,
    dueLabel && `Vence: ${dueLabel}`,
  ].filter(Boolean);

  return (
    <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2.5 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={() => onComplete(task.id)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-stone-300 text-transparent hover:border-stone-500 hover:text-stone-500"
        >
          <Check size={12} />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm text-stone-800">{task.title}</p>
          {relationParts.length > 0 && (
            <p className="truncate text-xs text-stone-400">{relationParts.join(' · ')}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {statusLabels[task.status] && task.status === 'IN_PROGRESS' && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
            {statusLabels[task.status]}
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityColors[task.priority]}`}>
          {priorityLabels[task.priority]}
        </span>
        <button
          onClick={() => onEdit(task)}
          className="rounded p-1 text-stone-300 hover:bg-stone-100 hover:text-stone-600"
        >
          <Pencil size={13} />
        </button>
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
  onEdit,
  accent,
}: {
  title: string;
  tasks: Task[];
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: Task) => void;
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
          <TaskRow key={task.id} task={task} onComplete={onComplete} onDelete={onDelete} onEdit={onEdit} />
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
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const groups = useMemo(() => groupTasks(tasks ?? []), [tasks]);

  async function handleCreate(data: TaskFormData) {
    await createTask({
      title: data.title,
      description: data.description || undefined,
      dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : undefined,
      priority: data.priority,
      type: data.type,
      ...(data.leadId ? { leadId: data.leadId } : {}),
      ...(data.contactId ? { contactId: data.contactId } : {}),
      ...(data.assignedTo ? { assignedTo: data.assignedTo } : {}),
    });
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    setModalOpen(false);
  }

  async function handleUpdate(data: TaskFormData) {
    if (!editingTask) return;
    await updateTask(editingTask.id, {
      title: data.title,
      description: data.description || undefined,
      dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : undefined,
      priority: data.priority,
      status: data.status,
      ...(data.assignedTo ? { assignedTo: data.assignedTo } : {}),
    });
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    setEditingTask(null);
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

      <TaskGroup title="Vencidas" tasks={groups.overdue} onComplete={handleComplete} onDelete={handleDelete} onEdit={setEditingTask} accent="text-red-600" />
      <TaskGroup title="Hoy" tasks={groups.today} onComplete={handleComplete} onDelete={handleDelete} onEdit={setEditingTask} />
      <TaskGroup title="Esta semana" tasks={groups.thisWeek} onComplete={handleComplete} onDelete={handleDelete} onEdit={setEditingTask} />
      <TaskGroup title="Más adelante" tasks={groups.later} onComplete={handleComplete} onDelete={handleDelete} onEdit={setEditingTask} />
      <TaskGroup title="Sin fecha" tasks={groups.noDate} onComplete={handleComplete} onDelete={handleDelete} onEdit={setEditingTask} />

      {modalOpen && <TaskModal onClose={() => setModalOpen(false)} onSubmit={handleCreate} />}
      {editingTask && (
        <TaskModal task={editingTask} onClose={() => setEditingTask(null)} onSubmit={handleUpdate} />
      )}
    </div>
  );
}
