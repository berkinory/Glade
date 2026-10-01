import { useState, type FormEvent } from "react";
import type {
  ProviderManageMcpServerInput,
  ProviderManagementScope,
} from "@glade/contracts/provider/providerManagement";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SelectItem } from "../ui/select";
import { SettingsSelectControl } from "./SettingControls";
import { SettingsListRow as SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

type NewServer = Pick<ProviderManageMcpServerInput, "name" | "scope" | "configuration">;

export function McpServerAddForm({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (server: NewServer) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("http");
  const [scope, setScope] = useState<ProviderManagementScope>("user");
  const [endpoint, setEndpoint] = useState("");
  const [args, setArgs] = useState("");
  const [authorization, setAuthorization] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await onAdd({
        name: name.trim(),
        scope,
        configuration:
          transport === "http"
            ? {
                transport,
                url: endpoint.trim(),
                ...(authorization ? { headers: { Authorization: authorization } } : {}),
              }
            : {
                transport,
                command: endpoint.trim(),
                args: args.split("\n").filter((arg) => arg.length > 0),
              },
      });
      setName("");
      setEndpoint("");
      setArgs("");
      setAuthorization("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the server.");
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)}>
      <SettingsSection title="Add MCP server">
        <SettingsRow
          title="Name"
          actions={
            <Input
              aria-label="MCP server name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          }
        />
        <SettingsRow
          title="Scope"
          description="User applies to your native provider account; project and local apply to the selected workspace."
          actions={
            <SettingsSelectControl
              value={scope}
              valueContent={scope}
              ariaLabel="MCP configuration scope"
              onValueChange={(value) => {
                if (value === "user" || value === "project" || value === "local") setScope(value);
              }}
            >
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="project">Project</SelectItem>
              <SelectItem value="local">Local</SelectItem>
            </SettingsSelectControl>
          }
        />
        <SettingsRow
          title="Transport"
          actions={
            <SettingsSelectControl
              value={transport}
              valueContent={transport === "http" ? "HTTP" : "Command (stdio)"}
              ariaLabel="MCP transport"
              onValueChange={(value) => {
                if (value === "http" || value === "stdio") {
                  setTransport(value);
                  setEndpoint("");
                }
              }}
            >
              <SelectItem value="http">HTTP</SelectItem>
              <SelectItem value="stdio">Command (stdio)</SelectItem>
            </SettingsSelectControl>
          }
        />
        <SettingsRow
          title={transport === "http" ? "Server URL" : "Command"}
          actions={
            <Input
              aria-label={transport === "http" ? "MCP server URL" : "MCP command"}
              type={transport === "http" ? "url" : "text"}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              required
            />
          }
        />
        {transport === "stdio" ? (
          <SettingsRow
            title="Arguments"
            description="One argument per line. Arguments are passed directly to the command."
            actions={
              <textarea
                aria-label="MCP command arguments"
                className="min-h-20 w-full rounded-md border bg-background p-2 text-ui"
                value={args}
                onChange={(event) => setArgs(event.target.value)}
              />
            }
          />
        ) : (
          <SettingsRow
            title="Authorization header"
            description="Optional. Stored by the native provider and never included in server listings."
            actions={
              <Input
                aria-label="MCP authorization header"
                type="password"
                autoComplete="off"
                value={authorization}
                onChange={(event) => setAuthorization(event.target.value)}
              />
            }
          />
        )}
        <SettingsRow
          title="Save native configuration"
          description="Reloading starts the configured server. Claude changes apply to the next session."
          actions={
            <Button type="submit" size="sm" disabled={pending}>
              Add server
            </Button>
          }
        />
        {error ? (
          <p role="alert" className="px-4 py-2 text-ui text-destructive">
            {error}
          </p>
        ) : null}
      </SettingsSection>
    </form>
  );
}
