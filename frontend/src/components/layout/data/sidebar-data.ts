import {
  Bell,
  Building2,
  FileSpreadsheet,
  FolderKanban,
  Gauge,
  HelpCircle,
  LayoutDashboard,
  ListTodo,
  Monitor,
  Palette,
  Settings,
  UserCog,
  Users,
  Wrench,
} from 'lucide-react'
import { type SidebarData } from '../types'

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
