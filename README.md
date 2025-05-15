# react-liverpc

A simple real-time RPC (Remote Procedure Call) library for React applications with Hono backend support. This library enables seamless real-time communication between your React frontend and Hono backend, with built-in support for live queries and mutations.

This library is designed to be flexible withe the choice of database/kv etc... While Hono is the only included backend supported, the library provide a way for the developer to use any socket by providing the needed function to the RPCs backend and frontend clients. The library supports manual invalidation of queries, allowing you to trigger real-time updates broadcasted to your client.

Notes:
- I like deploying my own Soketi service (Pusher alternative that allows to user the pusher-js packages). However, note that it has a 10Kb limit per broadcasted event...

## Features

- 🔄 Real-time data synchronization
- 🎯 Type-safe RPC calls
- 🔌 Built-in support for Hono backend
- 🚀 Easy integration with React Query
- 📡 Flexible socket implementation (Pusher, Socket.IO, etc.)
- 🔒 Built-in authorization support
- 🎨 Clean and intuitive API

## Installation

```bash
npm install react-liverpc
```
```bash
yarn add react-liverpc
```
```bash
pnpm add react-liverpc
```

## Quick Start

### Backend Setup (Hono)

```javascript
// rpc.ts

import { Hono } from 'hono';
import { LiveRPC, LiveRPCBuilder } from 'react-liverpc';
import { z } from 'zod';
import Pusher from 'pusher';

// Initialize Pusher (or your preferred real-time solution)
const pusher = new Pusher({
  // your backend pusher
});

// Create RPC configuration
const rpcConfig = new LiveRPCBuilder()
  .addQuery('getPosts', {
    params: z.undefined(),
    query: async (params, request) => {
      // Your database query here
      return await db.posts.findMany();
    }
  })
  .addQuery('getPost', {
    params: z.object({
      id: z.string().min(1)
    })
  })
  .addMutation('createPost', {
    params: z.object({
      title: z.string().min(1),
      content: z.string().min(1),
    }),
    mutation: async (params, request) => {
      // params here is parse by zod
      const { title, content } = params;
      const id = crypto.randomUUID();
      await db.posts.create({id, title, content});
      return {id, title, content}
    },
    invalidateQueries: {
      getPosts: () => undefined // Invalidate getPosts query after mutation
      getPost: (mutationParams, mutationResults) => ({id: mutationResults.id})
    }
  })
  .addMutation('deleteAllPosts', {
    params: z.undefined(),
    mutation: async (params, request) => {
      const IDs = await db.posts.findMany({ id }) // get all the ids string[]
      return IDs;
    },
    invalidateQueries: {
      getPosts: () => undefined // Invalidate getPosts query after mutation
      getPost: (mutationParams, mutationResults) => mutationResults.map(id => ({ id }))
    }
  });

// For client type-safety, export the type of your config
export type TypeMyLiveRPC = typeof config;

// Initialize LiveRPC
export const rpc = new LiveRPC({
  socket: {
    broadcast: async (channel, event, data) => {
      await pusher.trigger(channel, event, data);
    },
    batchBroadcast: async (broadcasts) => {
      await pusher.triggerBatch(broadcasts);
    },
    maxBatchSize: 10
  },
  config: rpcConfig
});
```

```javascript
// route.ts

import {rpc} from "./rpc"
// Create Hono app
const app = new Hono();

// Add RPC endpoint
app.post('/rpc/*', async (c) => {
  return await rpc.handleRequest(c);
});

export default app;
```

```typescript
// types.d.ts

// create this file, import the config type and export it 
// so that your client can only use the type from the backend,
// good for monorepos

import type { TypeMyLiveRPC } from "./config";

export type { TypeMyLiveRPC };
```

### Frontend Setup (React)

```jsx
// rpc.ts

import type { TypeMyLiveRPC } from "path_to_my_backend/type"
import { createClientLiveRPC } from 'react-liverpc';
import Pusher from 'pusher-js';

// Initialize Pusher client
const pusher = new Pusher('your-key', {
  // rest of pusher config
});

// Create RPC client
const { useQuery, useLiveQuery, useMutation } = createClientLiveRPC<TypeMyLiveRPC>({
  url: 'http://localhost:3000',
  basePath: '/rpc',
  socketFn: (channelName, eventName, callback) => {
    const channel = pusher.subscribe(channelName);
    channel.bind(eventName, callback);
    return () => {
      channel.unbind(eventName);
      pusher.unsubscribe(channelName);
    };
  }
});
```

```jsx
// post-page.tsx

// Use in your React components
function PostList() {
  // Regular query for all posts
  const { data: posts, isLoading } = useQuery('getPosts', undefined);

  // Live query for all posts (updates in real-time)
  const { data: livePosts, isLoading: isLoadingLive } = useLiveQuery('getPosts', undefined);

  // Mutations
  const createPost = useMutation('createPost');
  const deleteAllPosts = useMutation('deleteAllPosts');

  const handleCreatePost = async () => {
    await createPost.mutate({
      title: 'New Post',
      content: 'This is the content of my new post'
    });
  };

  const handleDeleteAllPosts = async () => {
    await deleteAllPosts.mutate(undefined);
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <h1>Posts</h1>
      <div className="actions">
        <button onClick={handleCreatePost}>Create New Post</button>
        <button onClick={handleDeleteAllPosts}>Delete All Posts</button>
      </div>
      <ul>
        {livePosts?.map(post => (
          <li key={post.id}>
            <h2>{post.title}</h2>
            <p>{post.content}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Example of a single post view component
function PostView({ postId }: { postId: string }) {
  // Live query for a single post
  const { data: post, isLoading } = useLiveQuery('getPost', { id: postId });

  if (isLoading) return <div>Loading...</div>;
  if (!post) return <div>Post not found</div>;

  return (
    <div>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </div>
  );
}
```

## Not included but could be added

- Additional backend framework integrations (Express.js)
- Enhanced error handling and retry mechanisms
- WebSocket fallback support
- Built-in caching strategies

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
