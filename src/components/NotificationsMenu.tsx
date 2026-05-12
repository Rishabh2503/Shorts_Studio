import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography
} from '@mui/material';
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BuildCircleRoundedIcon from '@mui/icons-material/BuildCircleRounded';
import BugReportRoundedIcon from '@mui/icons-material/BugReportRounded';
import { CHANGELOG, ChangelogKind } from '../data/changelog';

const STORAGE_KEY = 'shorts-studio:lastSeenChangelog';

/**
 * Visual treatment for each kind of changelog entry. Kept here (and not in
 * the data file) so the data layer stays a pure list of facts.
 */
const KIND_META: Record<
  ChangelogKind,
  { label: string; color: 'primary' | 'secondary' | 'warning'; icon: JSX.Element }
> = {
  feature: {
    label: 'New',
    color: 'secondary',
    icon: <AutoAwesomeIcon fontSize="small" sx={{ color: '#a78bfa' }} />
  },
  improvement: {
    label: 'Improved',
    color: 'primary',
    icon: <BuildCircleRoundedIcon fontSize="small" sx={{ color: '#22d3ee' }} />
  },
  fix: {
    label: 'Fixed',
    color: 'warning',
    icon: <BugReportRoundedIcon fontSize="small" sx={{ color: '#f59e0b' }} />
  }
};

export function NotificationsMenu() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  /**
   * The newest entry id the user has already opened. Persisted to
   * localStorage so the badge survives reloads. Default `''` means
   * everything is unread on first ever visit.
   */
  const [lastSeenId, setLastSeenId] = useState<string>('');

  // Hydrate from storage on mount. Wrapped in try/catch because
  // private-mode browsers can throw on localStorage access.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setLastSeenId(saved);
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * Unread = entries newer than (above in the array) the last seen one.
   * If nothing is saved yet we treat every entry as unread.
   */
  const unreadCount = useMemo(() => {
    if (!lastSeenId) return CHANGELOG.length;
    const idx = CHANGELOG.findIndex((e) => e.id === lastSeenId);
    return idx === -1 ? CHANGELOG.length : idx;
  }, [lastSeenId]);

  const open = !!anchorEl;

  const handleOpen = (e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
    // The act of opening the menu marks everything as seen \u2014
    // matches what users expect from a typical bell affordance.
    const topId = CHANGELOG[0]?.id;
    if (topId && topId !== lastSeenId) {
      setLastSeenId(topId);
      try {
        window.localStorage.setItem(STORAGE_KEY, topId);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <>
      <Tooltip
        title={
          unreadCount > 0
            ? `${unreadCount} new update${unreadCount === 1 ? '' : 's'}`
            : "What's new"
        }
        placement="bottom"
        arrow
      >
        <IconButton
          size="small"
          onClick={handleOpen}
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications, no unread updates'
          }
          aria-haspopup="dialog"
          aria-expanded={open ? 'true' : 'false'}
          sx={{
            color: unreadCount > 0 ? '#a78bfa' : 'text.secondary',
            transition: 'color 160ms ease',
            '&:hover': { color: '#fff', background: 'rgba(124,58,237,0.12)' }
          }}
        >
          <Badge
            color="error"
            badgeContent={unreadCount}
            overlap="circular"
            max={9}
          >
            {unreadCount > 0 ? (
              <NotificationsActiveRoundedIcon
                fontSize="small"
                // Gentle ring animation only while there ARE unread items.
                sx={{
                  animation: 'bell-shake 2.4s ease-in-out infinite',
                  transformOrigin: '50% 0%',
                  '@keyframes bell-shake': {
                    '0%, 60%, 100%': { transform: 'rotate(0deg)' },
                    '65%': { transform: 'rotate(12deg)' },
                    '70%': { transform: 'rotate(-10deg)' },
                    '75%': { transform: 'rotate(8deg)' },
                    '80%': { transform: 'rotate(-6deg)' },
                    '85%': { transform: 'rotate(3deg)' },
                    '90%': { transform: 'rotate(0deg)' }
                  }
                }}
              />
            ) : (
              <NotificationsNoneRoundedIcon fontSize="small" />
            )}
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              width: { xs: 'calc(100vw - 24px)', sm: 380 },
              maxWidth: 420,
              maxHeight: '70vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              backgroundImage:
                'linear-gradient(180deg, rgba(124,58,237,0.10) 0%, rgba(15,23,42,0) 80%)'
            }
          }
        }}
      >
        <Box sx={{ p: 2, pb: 1.5 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              What's new
            </Typography>
            <Chip
              size="small"
              label={`${CHANGELOG.length} updates`}
              variant="outlined"
              color="secondary"
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Recent rollouts to Shorts Studio.
          </Typography>
        </Box>
        <Divider />
        <Box sx={{ overflowY: 'auto', flex: 1 }}>
          {CHANGELOG.map((entry) => {
            const meta = KIND_META[entry.kind];
            return (
              <Box
                key={entry.id}
                sx={{
                  p: 2,
                  '&:not(:last-of-type)': {
                    borderBottom: '1px solid rgba(255,255,255,0.06)'
                  },
                  '&:hover': { background: 'rgba(255,255,255,0.02)' }
                }}
              >
                <Stack direction="row" spacing={1.25} alignItems="flex-start">
                  <Box
                    sx={{
                      mt: 0.25,
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,0.04)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    {meta.icon}
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{ mb: 0.25 }}
                    >
                      <Chip
                        size="small"
                        label={meta.label}
                        color={meta.color}
                        variant="outlined"
                        sx={{ height: 18, fontSize: 10, fontWeight: 700 }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {entry.date}
                      </Typography>
                    </Stack>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, lineHeight: 1.3 }}
                    >
                      {entry.title}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}
                    >
                      {entry.body}
                    </Typography>
                  </Box>
                </Stack>
              </Box>
            );
          })}
        </Box>
        <Divider />
        <Box sx={{ p: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" onClick={() => setAnchorEl(null)}>
            Close
          </Button>
        </Box>
      </Popover>
    </>
  );
}
