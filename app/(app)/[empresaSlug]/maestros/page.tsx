import { redirect } from 'next/navigation';

export default function MaestrosIndex({ params }: { params: { empresaSlug: string } }) {
  redirect(`/${params.empresaSlug}/maestros/categorias`);
}
