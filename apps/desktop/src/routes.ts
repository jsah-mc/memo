import { createHashRouter, redirect, type RouteObject } from "react-router";
import { AssistantPage } from "@/pages/assistant-page";

export const routes: RouteObject[] = [
  {
    path: "/",
    Component: AssistantPage,
  },
  {
    path: "*",
    loader: () => redirect("/"),
  },
];

export const router = createHashRouter(routes);
