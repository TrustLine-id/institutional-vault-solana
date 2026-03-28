import React from 'react';

export function StatTile(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{props.label}</span>
      <strong className="stat-value">{props.value}</strong>
      {props.hint ? <span className="stat-hint">{props.hint}</span> : null}
    </div>
  );
}

export function DetailRow(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="detail-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

export function RoleBadge(props: { label: string }) {
  return <span className="role-badge active">{props.label}</span>;
}
