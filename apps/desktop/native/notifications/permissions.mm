#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>
#include <string>

struct PermissionQuery {
  napi_async_work work;
  napi_deferred deferred;
  bool request;
  int status = -1;
  std::string error;
};

static void Execute(napi_env, void *data) {
  auto *query = static_cast<PermissionQuery *>(data);
  @autoreleasepool {
    @try {
      auto center = [UNUserNotificationCenter currentNotificationCenter];
      auto semaphore = dispatch_semaphore_create(0);
      __block NSInteger status = -1;
      __block NSString *failure = nil;
      if (query->request) {
        [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge)
          completionHandler:^(BOOL, NSError *error) {
            failure = error.localizedDescription;
            dispatch_semaphore_signal(semaphore);
          }];
        if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_SEC))) {
          query->error = "Notification permission request timed out.";
          return;
        }
        if (failure) {
          query->error = failure.UTF8String;
          return;
        }
      }
      [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
        status = settings.authorizationStatus;
        dispatch_semaphore_signal(semaphore);
      }];
      if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC))) {
        query->error = "Notification permission query timed out.";
        return;
      }
      query->status = static_cast<int>(status);
    } @catch (NSException *exception) {
      query->error = exception.reason.UTF8String;
    }
  }
}

static void Complete(napi_env env, napi_status status, void *data) {
  auto *query = static_cast<PermissionQuery *>(data);
  napi_value value;
  if (status != napi_ok || !query->error.empty()) {
    napi_value message;
    napi_create_string_utf8(env, query->error.empty() ? "Notification query cancelled." : query->error.c_str(), NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, nullptr, message, &value);
    napi_reject_deferred(env, query->deferred, value);
  } else {
    napi_create_int32(env, query->status, &value);
    napi_resolve_deferred(env, query->deferred, value);
  }
  napi_delete_async_work(env, query->work);
  delete query;
}

static napi_value Query(napi_env env, napi_callback_info info) {
  auto *query = new PermissionQuery{};
  size_t argc = 1;
  napi_value arg;
  napi_get_cb_info(env, info, &argc, &arg, nullptr, nullptr);
  if (argc != 1 || napi_get_value_bool(env, arg, &query->request) != napi_ok) {
    delete query;
    napi_throw_type_error(env, nullptr, "Expected a request boolean.");
    return nullptr;
  }
  napi_value promise, name;
  napi_create_promise(env, &query->deferred, &promise);
  napi_create_string_utf8(env, "NotificationPermission", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name, Execute, Complete, query, &query->work);
  napi_queue_async_work(env, query->work);
  return promise;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value query;
  napi_create_function(env, "query", NAPI_AUTO_LENGTH, Query, nullptr, &query);
  napi_set_named_property(env, exports, "query", query);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
