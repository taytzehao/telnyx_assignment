import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { handleGetFaq } from "./tools/get-faq";
import { handleCreateAppointment } from "./tools/create-appointment";
import { handleListAppointments } from "./tools/list-appointments";
import { handleCancelAppointments } from "./tools/cancel-appointments";

export function createMcpServer(env: Env): McpServer {
  const server = new McpServer(
    {
      name: "acme-clinic-mcp",
      version: "1.0.0",
    },
    {
      instructions:
        "MCP server for ACME Clinic assistant. Provides FAQ lookup and per-caller appointment management.",
    },
  );

  server.registerTool(
    "get_faq",
    {
      description:
        "Retrieve FAQ content for a given category. Supported categories: hours, location, services, fees.",
      inputSchema: {
        category: z.string().describe("FAQ category: hours, location, services, or fees"),
        caller_number: z.string().describe("The caller's phone number"),
      },
    },
    async (args) => {
      const { status, body } = await handleGetFaq(args, env);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status, ...body }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "create_appointment",
    {
      description:
        "Create a 30-minute appointment for the caller. Slots must be between 9 AM and 5 PM. Returns conflict details with suggestions if the slot overlaps an existing appointment.",
      inputSchema: {
        caller_number: z.string().describe("The caller's phone number"),
        date: z.string().describe("Appointment date in ISO format (YYYY-MM-DD)"),
        start_time: z.string().describe("Start time in HH:MM format (24-hour)"),
      },
    },
    async (args) => {
      const { status, body } = await handleCreateAppointment(args, env);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status, ...body }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_appointments",
    {
      description:
        "List all appointments belonging to the caller identified by their phone number.",
      inputSchema: {
        caller_number: z.string().describe("The caller's phone number"),
      },
    },
    async (args) => {
      const { status, body } = await handleListAppointments(args, env);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status, ...body }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "cancel_appointments",
    {
      description:
        "Cancel an appointment for the caller. Specify cancel_by='time' with date and start_time, or cancel_by='id' with the appointment_id.",
      inputSchema: {
        caller_number: z.string().describe("The caller's phone number"),
        cancel_by: z.enum(["time", "id"]).describe("Cancel by time slot or by appointment ID"),
        date: z.string().optional().describe("Appointment date (required when cancel_by='time')"),
        start_time: z.string().optional().describe("Start time HH:MM (required when cancel_by='time')"),
        appointment_id: z.string().optional().describe("Appointment ID (required when cancel_by='id')"),
      },
    },
    async (args) => {
      const { status, body } = await handleCancelAppointments(args, env);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status, ...body }),
          },
        ],
      };
    },
  );

  return server;
}
