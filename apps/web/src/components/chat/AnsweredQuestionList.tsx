export function AnsweredQuestionList(props: {
  items: ReadonlyArray<{ id: string; question: string; answer: string | null }>;
}) {
  return (
    <dl className="space-y-3 rounded-xl border border-border p-3.5 text-ui leading-snug">
      {props.items.map((item) => (
        <div key={item.id}>
          <dt className="font-medium">{item.question}</dt>
          <dd className="whitespace-pre-wrap text-muted-foreground">
            {item.answer ?? "No answer"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
