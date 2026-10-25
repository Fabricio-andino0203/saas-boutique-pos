import { messages } from "@/config/messages.es";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{messages.home.title}</h1>
      <p className="text-muted-foreground">{messages.home.description}</p>
    </div>
  );
}
