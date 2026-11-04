#include <node_api.h>
#include <dlfcn.h>
#include <cstdlib>
#include <string>
#include <vector>

using Request = char* (*)(const char*);
static void* library = nullptr;
static Request request = nullptr;
static std::string utf8(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);
  std::vector<char> bytes(length + 1);
  napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &length);
  return std::string(bytes.data(), length);
}
static napi_value call(napi_env env, napi_callback_info info) {
  size_t count = 2; napi_value args[2];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 2) { napi_throw_error(env, nullptr, "Library path and request JSON are required."); return nullptr; }
  for (size_t i = 0; i < 2; i++) { napi_valuetype type; napi_typeof(env, args[i], &type); if (type != napi_string) { napi_throw_type_error(env, nullptr, "Expected strings."); return nullptr; } }
  if (!request) {
    library = dlopen(utf8(env,args[0]).c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!library) { napi_throw_error(env,nullptr,"Could not load the native paste library."); return nullptr; }
    request = reinterpret_cast<Request>(dlsym(library,"snappaste_request"));
    if (!request) { napi_throw_error(env,nullptr,"Native paste entry point is unavailable."); return nullptr; }
  }
  char* output = request(utf8(env,args[1]).c_str());
  if (!output) { napi_throw_error(env,nullptr,"Native paste returned no result."); return nullptr; }
  napi_value value; napi_create_string_utf8(env,output,NAPI_AUTO_LENGTH,&value); free(output); return value;
}
NAPI_MODULE_INIT() {
  napi_value fn; napi_create_function(env,"request",NAPI_AUTO_LENGTH,call,nullptr,&fn);
  napi_set_named_property(env,exports,"request",fn); return exports;
}
