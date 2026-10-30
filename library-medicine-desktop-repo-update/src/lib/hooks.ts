import { keepPreviousData, useQuery } from '@tanstack/react-query';
import * as store from './db';

/** Records of a project on this computer (same cache key the Data page uses). Keeps the last result while refreshing so pages never flash empty. */
export const useRecords = (project: string) => useQuery({ queryKey: ['records', project, ''], queryFn: () => store.listRecords(project, ''), placeholderData: keepPreviousData, staleTime: 3000 });
