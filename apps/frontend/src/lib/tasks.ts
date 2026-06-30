import api from './axios';
import { Task } from '@/types';

export async function getTasks(): Promise<Task[]> {
  const { data } = await api.get<Task[]>('/tasks');
  return data;
}

export async function createTask(payload: {
  title: string;
  description?: string;
  dueDate?: string;
  priority?: string;
  type?: string;
}): Promise<Task> {
  const { data } = await api.post<Task>('/tasks', payload);
  return data;
}

export async function completeTask(id: string): Promise<Task> {
  const { data } = await api.patch<Task>(`/tasks/${id}/complete`);
  return data;
}

export async function deleteTask(id: string): Promise<void> {
  await api.delete(`/tasks/${id}`);
}