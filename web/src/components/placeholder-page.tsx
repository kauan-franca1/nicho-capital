import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";

/** Casca de página das fases futuras: título, promessa e o que vai aparecer aqui. */
export function PlaceholderPage({
  title,
  subtitle,
  fase,
  children,
}: {
  title: string;
  subtitle: string;
  fase: number;
  children: string;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState title={`Chega na fase ${fase}`}>{children}</EmptyState>
    </>
  );
}
