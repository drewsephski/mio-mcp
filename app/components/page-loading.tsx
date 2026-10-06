import { Brand } from "./brand";
import { DotsRing } from "./ui/dots-ring";

export function PageLoading({ message }: { message: string }) {
  return <main className="page-loading" aria-busy="true"><Brand /><DotsRing className="size-8 text-blue-700" aria-label={message} /><p aria-hidden="true">{message}</p></main>;
}
