import {
  Bell,
  Building2,
  FileSpreadsheet,
  FolderKanban,
  Gauge,
  HelpCircle,
  LayoutDashboard,
  ListTodo,
  MessagesSquare,
  Monitor,
  PackageSearch,
  Palette,
  Settings,
  UserCog,
  Users,
  Wrench,
  Activity,
  AlertOctagon,
  AlertTriangle,
  CalendarRange,
  Coins,
  FileDiff,
  History,
  Link2,
  Network,
  TrendingUp,
  UsersRound,
} from 'lucide-react'
import type { ModuleKey } from '@/features/projects/lib/project-modules'
import { type SidebarData } from '../types'

/**
 * One entry of the Project Controls group: where it opens inside the project
 * (a module, and the sub-tab when the module has one). The entries are
 * written against modules, not URLs, because a project's pages live under
 * `/o/{workspace}/projects/{id}/…` and the shell builds the address.
 */
export type ProjectControlsEntry = {
  key: string
  title: string
  module: ModuleKey
  child?: string
  icon: React.ElementType
}

/**
 * The Project Controls group inside a project (integration doc §2, §19):
 * the bill, the programme, the mapping between them and what follows from
 * it, in the order the work runs — one group, so Schedule and BOQ read as
 * one product. Only pages that exist today are listed; Structure is the
 * §89 step between the profile and the bill, so it sits second.
 */
export const projectControlsGroup: {
  title: string
  items: ProjectControlsEntry[]
} = {
  title: 'Project Controls',
  items: [
    { key: 'overview', title: 'Overview', module: 'overview', icon: LayoutDashboard },
    {
      key: 'structure',
      title: 'Structure',
      module: 'controls',
      child: 'structure',
      icon: Network,
    },
    { key: 'schedule', title: 'Schedule', module: 'schedule', child: 'gantt', icon: CalendarRange },
    { key: 'boq', title: 'BOQ', module: 'boq', icon: FileSpreadsheet },
    { key: 'mapping', title: 'Mapping', module: 'controls', child: 'mapping', icon: Link2 },
    { key: 'progress', title: 'Progress', module: 'schedule', child: 'progress', icon: Activity },
    { key: 'cost', title: 'Cost', module: 'cost', child: 'overview', icon: Coins },
    { key: 'forecast', title: 'Forecast', module: 'schedule', child: 'forecast', icon: TrendingUp },
    // Change events and the change orders they become (PC-0 decision table,
    // integration doc §2): the Commercial module's pages, opened at change
    // events, and offered only when that page is.
    { key: 'changes', title: 'Changes', module: 'commercial', child: 'change-events', icon: FileDiff },
    // PC-7b: the reviewed exceptions the controls engine derives, and the
    // handoff from one to a draft change event (change intelligence §6).
    {
      key: 'exceptions',
      title: 'Exceptions',
      module: 'controls',
      child: 'exceptions',
      icon: AlertOctagon,
    },
    { key: 'resources', title: 'Resources', module: 'schedule', child: 'resources', icon: UsersRound },
    { key: 'risks', title: 'Risks', module: 'schedule', child: 'risks', icon: AlertTriangle },
    {
      key: 'revisions',
      title: 'Baselines / Revisions',
      module: 'schedule',
      child: 'revisions',
      icon: History,
    },
  ],
}

/**
 * Primary navigation.
 *
 * Group 0 ("Work") holds the workspace pages a construction team uses daily;
 * group 1 ("Account") holds settings and help. Top-level entries can be hidden
 * per user through Settings › Display (see `displayNavigationItems`).
 */
export const sidebarData: SidebarData = {
  user: {
    name: 'OctaPM user',
    email: '',
    avatar: '',
  },
  navGroups: [
    {
      title: 'Work',
      items: [
        {
          title: 'Dashboard',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'Projects',
          url: '/projects',
          icon: FolderKanban,
        },
        {
          title: 'Portfolio',
          url: '/portfolio',
          icon: Gauge,
        },
        {
          title: 'Inventory',
          url: '/inventory',
          icon: PackageSearch,
        },
        {
          title: 'Reports',
          url: '/reports',
          icon: FileSpreadsheet,
        },
        {
          title: 'Tasks',
          url: '/tasks',
          icon: ListTodo,
        },
        {
          title: 'Messages',
          url: '/messages',
          icon: MessagesSquare,
        },
        {
          title: 'Users',
          url: '/users',
          icon: Users,
        },
        {
          title: 'Company',
          url: '/company/directory',
          icon: Building2,
        },
      ],
    },
    {
      title: 'Account',
      items: [
        {
          title: 'Settings',
          icon: Settings,
          items: [
            {
              title: 'Profile',
              url: '/settings',
              icon: UserCog,
            },
            {
              title: 'Account',
              url: '/settings/account',
              icon: Wrench,
            },
            {
              title: 'Appearance',
              url: '/settings/appearance',
              icon: Palette,
            },
            {
              title: 'Notifications',
              url: '/settings/notifications',
              icon: Bell,
            },
            {
              title: 'Display',
              url: '/settings/display',
              icon: Monitor,
            },
          ],
        },
        {
          title: 'Help Center',
          url: '/help-center',
          icon: HelpCircle,
        },
      ],
    },
  ],
}
