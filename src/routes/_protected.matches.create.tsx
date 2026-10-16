import { createFileRoute } from '@tanstack/react-router';
import { CreateMatchPage } from '../features/matches/CreateMatchPage';
export const Route = createFileRoute('/_protected/matches/create')({ component: CreateMatchPage });
