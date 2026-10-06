import { Brand } from "./brand";

export function PageLoading({ message }: { message: string }) {
  return <main className="page-loading" aria-busy="true"><Brand /><p role="status">{message}</p></main>;
}
