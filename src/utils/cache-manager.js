// src/utils/cache-manager.js
const Redis = require('ioredis');

class CacheManager {
  constructor() {
    this.redis = null;
    this.memoryCache = new Map();
    this.memoryTTL = new Map();
    this.requestCache = new Map(); // For request deduplication
    
    this.initializeRedis();
  }

  initializeRedis() {
    try {
      if (process.env.REDIS_URL) {
        this.redis = new Redis(process.env.REDIS_URL, {
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
          lazyConnect: true
        });

        this.redis.on('error', (error) => {
          console.warn('Redis connection error, falling back to memory cache:', error.message);
          this.redis = null;
        });

        this.redis.on('connect', () => {
          console.log('✅ Redis cache connected');
        });
      } else {
        console.log('📝 No Redis URL provided, using memory cache only');
      }
    } catch (error) {
      console.warn('Redis initialization failed, using memory cache:', error.message);
      this.redis = null;
    }
  }

  // Vault data caching
  async getVaultData(key) {
    try {
      if (this.redis) {
        const cached = await this.redis.get(`vault:${key}`);
        if (cached) {
          return JSON.parse(cached);
        }
      } else {
        // Memory cache fallback
        const cached = this.memoryCache.get(`vault:${key}`);
        if (cached && this.memoryTTL.get(`vault:${key}`) > Date.now()) {
          return cached;
        }
      }
      return null;
    } catch (error) {
      console.error('Cache get error:', error.message);
      return null;
    }
  }

  async setVaultData(key, data, ttlSeconds = 600) { // 10 minutes default
    try {
      if (this.redis) {
        await this.redis.setex(`vault:${key}`, ttlSeconds, JSON.stringify(data));
      } else {
        // Memory cache fallback
        this.memoryCache.set(`vault:${key}`, data);
        this.memoryTTL.set(`vault:${key}`, Date.now() + (ttlSeconds * 1000));
        
        // Clean up old entries
        this.cleanupMemoryCache();
      }
    } catch (error) {
      console.error('Cache set error:', error.message);
    }
  }

  // Risk score caching
  async getRiskScore(vaultKey) {
    try {
      if (this.redis) {
        const cached = await this.redis.get(`risk:${vaultKey}`);
        if (cached) {
          return JSON.parse(cached);
        }
      } else {
        const cached = this.memoryCache.get(`risk:${vaultKey}`);
        if (cached && this.memoryTTL.get(`risk:${vaultKey}`) > Date.now()) {
          return cached;
        }
      }
      return null;
    } catch (error) {
      console.error('Risk cache get error:', error.message);
      return null;
    }
  }

  async setRiskScore(vaultKey, riskData, ttlSeconds = 3600) { // 1 hour default
    try {
      if (this.redis) {
        await this.redis.setex(`risk:${vaultKey}`, ttlSeconds, JSON.stringify(riskData));
      } else {
        this.memoryCache.set(`risk:${vaultKey}`, riskData);
        this.memoryTTL.set(`risk:${vaultKey}`, Date.now() + (ttlSeconds * 1000));
      }
    } catch (error) {
      console.error('Risk cache set error:', error.message);
    }
  }

  // Request deduplication
  async getOrSetWithDeduplication(key, asyncFunction, ttlSeconds = 300) {
    const cacheKey = `dedup:${key}`;
    
    // Check if request is already in progress
    if (this.requestCache.has(cacheKey)) {
      console.log(`🔄 Request deduplication hit for ${key}`);
      return this.requestCache.get(cacheKey);
    }

    // Check cache first
    const cached = await this.getVaultData(key);
    if (cached) {
      console.log(`💾 Cache hit for ${key}`);
      return cached;
    }

    // Execute function and cache the promise to avoid duplicate requests
    console.log(`🔍 Cache miss for ${key}, executing function`);
    const promise = asyncFunction().then(async (result) => {
      if (result) {
        await this.setVaultData(key, result, ttlSeconds);
      }
      this.requestCache.delete(cacheKey);
      return result;
    }).catch((error) => {
      this.requestCache.delete(cacheKey);
      throw error;
    });

    this.requestCache.set(cacheKey, promise);
    return promise;
  }

  // API response caching
  async getAPIResponse(endpoint, params = {}) {
    const key = `api:${endpoint}:${JSON.stringify(params)}`;
    return this.getVaultData(key);
  }

  async setAPIResponse(endpoint, params = {}, data, ttlSeconds = 300) {
    const key = `api:${endpoint}:${JSON.stringify(params)}`;
    return this.setVaultData(key, data, ttlSeconds);
  }

  // Batch operations for better performance
  async setBatch(keyValuePairs, ttlSeconds = 600) {
    try {
      if (this.redis) {
        const pipeline = this.redis.pipeline();
        for (const [key, value] of keyValuePairs) {
          pipeline.setex(`vault:${key}`, ttlSeconds, JSON.stringify(value));
        }
        await pipeline.exec();
      } else {
        // Memory cache batch
        const expiry = Date.now() + (ttlSeconds * 1000);
        for (const [key, value] of keyValuePairs) {
          this.memoryCache.set(`vault:${key}`, value);
          this.memoryTTL.set(`vault:${key}`, expiry);
        }
      }
    } catch (error) {
      console.error('Batch cache set error:', error.message);
    }
  }

  // Cache invalidation
  async invalidatePattern(pattern) {
    try {
      if (this.redis) {
        const keys = await this.redis.keys(`*${pattern}*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
          console.log(`🗑️ Invalidated ${keys.length} cache entries matching ${pattern}`);
        }
      } else {
        // Memory cache pattern invalidation
        const keysToDelete = [];
        for (const key of this.memoryCache.keys()) {
          if (key.includes(pattern)) {
            keysToDelete.push(key);
          }
        }
        keysToDelete.forEach(key => {
          this.memoryCache.delete(key);
          this.memoryTTL.delete(key);
        });
        console.log(`🗑️ Invalidated ${keysToDelete.length} memory cache entries matching ${pattern}`);
      }
    } catch (error) {
      console.error('Cache invalidation error:', error.message);
    }
  }

  // Memory cache cleanup
  cleanupMemoryCache() {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [key, expiry] of this.memoryTTL.entries()) {
      if (expiry <= now) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      this.memoryCache.delete(key);
      this.memoryTTL.delete(key);
    });

    if (keysToDelete.length > 0) {
      console.log(`🧹 Cleaned up ${keysToDelete.length} expired cache entries`);
    }
  }

  // Health check
  async healthCheck() {
    try {
      if (this.redis) {
        await this.redis.ping();
        return { redis: 'connected', memory_entries: this.memoryCache.size };
      } else {
        return { redis: 'disconnected', memory_entries: this.memoryCache.size };
      }
    } catch (error) {
      return { redis: 'error', memory_entries: this.memoryCache.size };
    }
  }

  // Graceful shutdown
  async close() {
    try {
      if (this.redis) {
        await this.redis.quit();
        console.log('Redis connection closed');
      }
      this.memoryCache.clear();
      this.memoryTTL.clear();
      this.requestCache.clear();
    } catch (error) {
      console.error('Cache close error:', error.message);
    }
  }
}

module.exports = CacheManager;