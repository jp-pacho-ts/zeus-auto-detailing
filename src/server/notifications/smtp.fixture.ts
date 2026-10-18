// Loopback SMTP protocol simulator: real nodemailer sockets, ephemeral test-only TLS keys.
import { createServer as createTcpServer, type Socket } from "node:net";
import {
  createServer as createTlsServer,
  createSecureContext,
  TLSSocket,
} from "node:tls";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const certificates = new Map<string, { key: string; cert: string }>();
export function smtpCertificate(name = "localhost") {
  const cached = certificates.get(name);
  if (cached) return cached;
  const dir = mkdtempSync(path.join(tmpdir(), "zeus-smtp-test-"));
  const bin =
    process.env.OPENSSL_BIN ??
    (process.platform === "win32"
      ? "C:/Program Files/Git/usr/bin/openssl.exe"
      : "openssl");
  const result = spawnSync(
    bin,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=" + name,
      "-addext",
      name === "localhost"
        ? "subjectAltName=DNS:localhost,IP:127.0.0.1"
        : "subjectAltName=DNS:" + name,
      "-keyout",
      path.join(dir, "key.pem"),
      "-out",
      path.join(dir, "cert.pem"),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0)
    throw new Error(
      "Cannot create ephemeral SMTP TLS fixture: OpenSSL is required",
    );
  const certificate = {
    key: readFileSync(path.join(dir, "key.pem"), "utf8"),
    cert: readFileSync(path.join(dir, "cert.pem"), "utf8"),
  };
  certificates.set(name, certificate);
  return certificate;
}
export interface SimulatedEmail {
  raw: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
}
export async function smtpSimulation(
  mode: "TLS" | "STARTTLS" | "PLAIN" = "TLS",
  certificateName = "localhost",
) {
  const cert = smtpCertificate(certificateName),
    messages: SimulatedEmail[] = [],
    attempts: SimulatedEmail[] = [],
    commands: string[] = [],
    sockets = new Set<Socket>();
  let reject = false,
    hang = false;
  function attach(socket: Socket, secure: boolean, greeting = true) {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = "",
      data = false,
      body: string[] = [],
      to = "",
      authStep = 0;
    const write = (v: string) => {
      if (!socket.destroyed) socket.write(v + "\r\n");
    };
    if (greeting) write("220 localhost synthetic SMTP");
    function onData(chunk: Buffer) {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n"),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line !== ".") {
            body.push(line.replace(/^\.\./, "."));
            continue;
          }
          data = false;
          const raw = body.join("\r\n"),
            split = raw.indexOf("\r\n\r\n"),
            headers = raw.slice(0, split).replace(/\r\n[ \t]+/g, " ");
          let text = raw.slice(split + 4);
          const header = (key: string) =>
            new RegExp("^" + key + ":\\s*(.*)$", "im").exec(headers)?.[1] ?? "";
          if (header("Content-Transfer-Encoding").toLowerCase() === "base64")
            text = Buffer.from(text.replace(/\s/g, ""), "base64").toString(
              "utf8",
            );
          else if (
            header("Content-Transfer-Encoding").toLowerCase() ===
            "quoted-printable"
          )
            text = Buffer.from(
              text
                .replace(/=\r\n/g, "")
                .replace(/=([0-9A-F]{2})/gi, (_, hex) =>
                  String.fromCharCode(parseInt(hex, 16)),
                ),
              "binary",
            ).toString("utf8");
          const email = {
            raw,
            to,
            subject: header("Subject"),
            text: text.replace(/\r\n/g, "\n").trimEnd(),
            messageId: header("Message-ID"),
          };
          attempts.push(email);
          if (reject) {
            write("451 Synthetic temporary rejection");
            continue;
          }
          messages.push(email);
          write("250 Message accepted");
          continue;
        }
        if (authStep) {
          if (authStep === 1) {
            authStep = 2;
            write("334 UGFzc3dvcmQ6");
          } else {
            authStep = 0;
            write("235 Authenticated");
          }
          continue;
        }
        const command = line.split(" ")[0].toUpperCase();
        commands.push(command);
        if (hang) continue;
        if (command === "EHLO" || command === "HELO") {
          write("250-localhost");
          if (!secure && mode === "STARTTLS") write("250-STARTTLS");
          write("250 AUTH PLAIN LOGIN");
        } else if (command === "STARTTLS") {
          if (mode !== "STARTTLS" || secure) {
            write("502 TLS unavailable");
            continue;
          }
          write("220 Begin TLS");
          socket.removeListener("data", onData);
          const tls = new TLSSocket(socket, {
            isServer: true,
            secureContext: createSecureContext(cert),
          });
          attach(tls, true, false);
          return;
        } else if (command === "AUTH") {
          if (!secure) {
            write("538 TLS required");
            continue;
          }
          if (line.startsWith("AUTH LOGIN")) {
            authStep = 1;
            write("334 VXNlcm5hbWU6");
          } else write("235 Authenticated");
        } else if (command === "MAIL" || command === "RSET") write("250 OK");
        else if (command === "RCPT") {
          to = /<([^>]+)>/.exec(line)?.[1] ?? "";
          write("250 OK");
        } else if (command === "DATA") {
          body = [];
          data = true;
          write("354 End with dot");
        } else if (command === "QUIT") {
          write("221 Bye");
          socket.end();
        } else write("502 Unsupported");
      }
    }
    socket.on("data", onData);
  }
  const server =
    mode === "TLS"
      ? createTlsServer(cert, (s) => attach(s, true))
      : createTcpServer((s) => attach(s, false));
  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    messages,
    attempts,
    commands,
    config: {
      host: "127.0.0.1",
      port,
      secure: mode === "TLS",
      user: "shop@example.test",
      password: "synthetic-app-password",
      from: "Zeus <shop@example.test>",
      shopEmail: "shop@example.test",
      origin: "http://localhost:3000",
      ca: cert.cert,
    },
    setRejected: (value: boolean) => {
      reject = value;
    },
    setHanging: (value: boolean) => {
      hang = value;
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
