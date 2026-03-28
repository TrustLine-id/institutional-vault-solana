import React from 'react';
import { AdminTab, RoleFlags } from '../types';

export function TabStrip(props: {
  activeTab: AdminTab;
  roleFlags: RoleFlags;
  onSelectTab: (tab: AdminTab) => void;
}) {
  return (
    <section className="tab-strip">
      <button
        type="button"
        className={props.activeTab === 'investor' ? 'active' : ''}
        onClick={() => props.onSelectTab('investor')}
      >
        Investor
      </button>
      {props.roleFlags.authority ? (
        <button
          type="button"
          className={props.activeTab === 'authority' ? 'active' : ''}
          onClick={() => props.onSelectTab('authority')}
        >
          Authority
        </button>
      ) : null}
      {props.roleFlags.curator ? (
        <button
          type="button"
          className={props.activeTab === 'curator' ? 'active' : ''}
          onClick={() => props.onSelectTab('curator')}
        >
          Curator
        </button>
      ) : null}
      {props.roleFlags.allocator ? (
        <button
          type="button"
          className={props.activeTab === 'allocator' ? 'active' : ''}
          onClick={() => props.onSelectTab('allocator')}
        >
          Allocator
        </button>
      ) : null}
    </section>
  );
}
